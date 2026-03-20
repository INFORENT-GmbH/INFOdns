import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { query, queryOne, execute } from './db.js'
import { queueMail } from './mailer.js'
import { broadcastEvent } from './broadcast.js'

const IMAP_ENABLED  = process.env.IMAP_ENABLED === 'true'
const IMAP_HOST     = process.env.IMAP_HOST ?? ''
const IMAP_PORT     = Number(process.env.IMAP_PORT ?? 993)
const IMAP_USER     = process.env.IMAP_USER ?? ''
const IMAP_PASS     = process.env.IMAP_PASS ?? ''
const IMAP_TLS      = process.env.IMAP_TLS !== 'false'
const IMAP_INTERVAL = Number(process.env.IMAP_POLL_INTERVAL_SECONDS ?? 60) * 1000
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? ''

let lastImapPoll = 0

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
    console.log(`[imap] Appended message to ticket #${ticketId}`)
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

    console.log(`[imap] Created ticket #${newTicketId} from ${fromAddr}`)
  }
}

// ── IMAP session ──────────────────────────────────────────────

async function runImapSession(): Promise<void> {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: IMAP_TLS,
    auth: { user: IMAP_USER, pass: IMAP_PASS },
    logger: false,
  })

  await client.connect()

  const lock = await client.getMailboxLock('INBOX')
  try {
    const uids = await client.search({ all: true }, { uid: true })
    if (!uids || uids.length === 0) return

    for (const uid of uids as number[]) {
      try {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
        if (!msg || !('source' in msg) || !msg.source) continue

        const parsed = await simpleParser(msg.source as Buffer)
        await handleParsedEmail(parsed)
        await client.messageDelete(String(uid), { uid: true })
      } catch (err: any) {
        console.error(`[imap] Failed to process UID ${uid}:`, err.message)
      }
    }
  } finally {
    lock.release()
  }

  await client.logout()
}

// ── Public poll function ──────────────────────────────────────

export async function pollImap(): Promise<void> {
  if (!IMAP_ENABLED) return
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASS) return
  if (Date.now() - lastImapPoll < IMAP_INTERVAL) return

  lastImapPoll = Date.now()
  console.log('[imap] Polling mailbox…')

  try {
    await runImapSession()
    console.log('[imap] Poll complete')
  } catch (err: any) {
    console.error('[imap] Poll failed:', err.message)
  }
}
