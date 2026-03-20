import { simpleParser } from 'mailparser'
import Pop3Command from 'node-pop3'
import { query, queryOne, execute } from './db.js'
import { queueMail } from './mailer.js'
import { broadcastEvent } from './broadcast.js'

const POP3_ENABLED   = process.env.POP3_ENABLED === 'true'
const POP3_HOST      = process.env.POP3_HOST ?? ''
const POP3_PORT      = Number(process.env.POP3_PORT ?? 995)
const POP3_USER      = process.env.POP3_USER ?? ''
const POP3_PASS      = process.env.POP3_PASS ?? ''
const POP3_TLS       = process.env.POP3_TLS !== 'false'
const POP3_INTERVAL  = Number(process.env.POP3_POLL_INTERVAL_SECONDS ?? 60) * 1000
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? ''

let lastPop3Poll = 0

// ── Threading helpers ─────────────────────────────────────────

async function findTicketByMessageId(msgId: string): Promise<number | null> {
  const row = await queryOne<{ ticket_id: number }>(
    'SELECT ticket_id FROM ticket_messages WHERE message_id = ? LIMIT 1',
    [msgId]
  )
  if (row) return row.ticket_id
  const ticket = await queryOne<{ id: number }>(
    'SELECT id FROM support_tickets WHERE message_id = ? LIMIT 1',
    [msgId]
  )
  return ticket?.id ?? null
}

function extractTicketRef(subject: string): number | null {
  const m = subject.match(/\[#(\d+)\]/)
  return m ? Number(m[1]) : null
}

async function lookupCustomerByEmail(email: string): Promise<number | null> {
  const row = await queryOne<{ customer_id: number }>(
    `SELECT uc.customer_id FROM users u
     JOIN user_customers uc ON uc.user_id = u.id
     WHERE u.email = ? LIMIT 1`,
    [email]
  )
  return row?.customer_id ?? null
}

// ── Ticket creation / threading ───────────────────────────────

async function handleParsedEmail(parsed: Awaited<ReturnType<typeof simpleParser>>): Promise<void> {
  const fromAddr  = parsed.from?.value?.[0]?.address ?? ''
  const fromName  = parsed.from?.value?.[0]?.name ?? ''
  const subject   = parsed.subject ?? '(no subject)'
  const body      = parsed.text ?? (parsed.html ? parsed.html.replace(/<[^>]+>/g, '') : '')
  const msgId     = parsed.messageId ?? null
  const inReplyTo = parsed.inReplyTo ?? null
  const references = parsed.references

  let ticketId: number | null = null

  if (inReplyTo) {
    ticketId = await findTicketByMessageId(inReplyTo)
  }

  if (!ticketId && references) {
    const refs = Array.isArray(references) ? references : [references]
    for (const ref of refs) {
      ticketId = await findTicketByMessageId(ref)
      if (ticketId) break
    }
  }

  if (!ticketId) {
    const refId = extractTicketRef(subject)
    if (refId) {
      const exists = await queryOne<{ id: number }>('SELECT id FROM support_tickets WHERE id = ?', [refId])
      if (exists) ticketId = refId
    }
  }

  if (ticketId) {
    try {
      await execute(
        `INSERT INTO ticket_messages (ticket_id, author_name, author_email, body, source, message_id)
         VALUES (?, ?, ?, ?, 'email', ?)`,
        [ticketId, fromName, fromAddr, body, msgId]
      )
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') return
      throw err
    }
    await execute('UPDATE support_tickets SET updated_at = NOW() WHERE id = ?', [ticketId])
    broadcastEvent({ type: 'ticket_message_added', ticketId })
    console.log(`[pop3] Appended message to ticket #${ticketId}`)
  } else {
    const customerId = fromAddr ? await lookupCustomerByEmail(fromAddr) : null

    let newTicketId: number
    try {
      const result = await execute(
        `INSERT INTO support_tickets (subject, requester_email, requester_name, customer_id, source, message_id)
         VALUES (?, ?, ?, ?, 'email', ?)`,
        [subject, fromAddr, fromName, customerId, msgId]
      )
      newTicketId = result.insertId
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') return
      throw err
    }

    await execute(
      `INSERT INTO ticket_messages (ticket_id, author_name, author_email, body, source, message_id)
       VALUES (?, ?, ?, ?, 'email', ?)`,
      [newTicketId, fromName, fromAddr, body, msgId]
    )

    broadcastEvent({ type: 'ticket_created', ticketId: newTicketId })

    if (fromAddr) {
      queueMail(fromAddr, 'ticket_created', {
        ticketId: newTicketId,
        subject,
        requesterName: fromName,
        portalUrl: APP_PUBLIC_URL,
      })
    }

    console.log(`[pop3] Created ticket #${newTicketId} from ${fromAddr}`)
  }
}

// ── POP3 session ──────────────────────────────────────────────

async function runPop3Session(): Promise<void> {
  const pop3 = new Pop3Command({
    user: POP3_USER,
    password: POP3_PASS,
    host: POP3_HOST,
    port: POP3_PORT,
    tls: POP3_TLS,
    timeout: 30_000,
  })

  try {
    // UIDL returns [['msgNum', 'uid'], ...]
    const uidlList = (await pop3.UIDL()) as [string, string][]
    if (uidlList.length === 0) {
      await pop3.QUIT()
      return
    }

    // Filter already-seen UIDs
    const allUids = uidlList.map(([, uid]) => uid)
    const placeholders = allUids.map(() => '?').join(',')
    const seen = await query<{ uid: string }>(
      `SELECT uid FROM pop3_seen_uids WHERE uid IN (${placeholders})`,
      allUids
    )
    const seenSet = new Set(seen.map(r => r.uid))

    const toProcess = uidlList.filter(([, uid]) => !seenSet.has(uid))

    for (const [msgNum, uid] of toProcess) {
      try {
        const raw: string = await pop3.RETR(Number(msgNum))
        const parsed = await simpleParser(raw)
        await handleParsedEmail(parsed)
        await execute('INSERT IGNORE INTO pop3_seen_uids (uid) VALUES (?)', [uid])
        await pop3.DELE(Number(msgNum))
      } catch (err: any) {
        console.error(`[pop3] Failed to process message ${msgNum} (${uid}):`, err.message)
      }
    }

    await pop3.QUIT()
  } catch (err) {
    try { await pop3.QUIT() } catch {}
    throw err
  }
}

// ── Public poll function ──────────────────────────────────────

export async function pollPop3(): Promise<void> {
  if (!POP3_ENABLED) return
  if (!POP3_HOST || !POP3_USER || !POP3_PASS) return
  if (Date.now() - lastPop3Poll < POP3_INTERVAL) return

  lastPop3Poll = Date.now()
  console.log('[pop3] Polling mailbox…')

  try {
    await runPop3Session()
    console.log('[pop3] Poll complete')
  } catch (err: any) {
    console.error('[pop3] Poll failed:', err.message)
  }
}
