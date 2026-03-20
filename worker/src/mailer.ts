import nodemailer from 'nodemailer'
import { query, execute } from './db.js'
import { renderTemplate, type Locale } from './mailTemplates.js'
import { broadcastEvent } from './broadcast.js'

const SMTP_HOST = process.env.SMTP_HOST ?? ''
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587)
const SMTP_USER = process.env.SMTP_USER ?? ''
const SMTP_PASS = process.env.SMTP_PASS ?? ''
const SMTP_FROM = process.env.SMTP_FROM ?? SMTP_USER
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME ?? ''
const mailFrom = MAIL_FROM_NAME ? `"${MAIL_FROM_NAME}" <${SMTP_FROM}>` : SMTP_FROM

const MAIL_BATCH_SIZE = 10

const transport = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      requireTLS: SMTP_PORT !== 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null

// ── Queue: insert a mail job ─────────────────────────────────

export async function queueMail(to: string, template: string, payload: unknown): Promise<void> {
  await execute(
    `INSERT INTO mail_queue (to_email, template, payload) VALUES (?, ?, ?)`,
    [to, template, JSON.stringify(payload)]
  )
}

// ── Queue: poll and send ─────────────────────────────────────

interface MailRow {
  id: number
  to_email: string
  template: string | null
  payload: string | null
  subject: string | null
  body_html: string | null
  body_text: string | null
  retries: number
  max_retries: number
}

export async function pollMailQueue(): Promise<void> {
  if (!transport) return

  const candidates = await query<MailRow>(
    `SELECT id, to_email, template, payload, subject, body_html, body_text, retries, max_retries
     FROM mail_queue
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT ?`,
    [MAIL_BATCH_SIZE]
  )

  for (const mail of candidates) {
    // Optimistic claim
    const claimed = await execute(
      `UPDATE mail_queue SET status = 'processing', updated_at = NOW()
       WHERE id = ? AND status = 'pending'`,
      [mail.id]
    )
    if (claimed.affectedRows === 0) continue

    try {
      let subject = mail.subject
      let html = mail.body_html
      let text = mail.body_text

      // Render template if set
      if (mail.template && mail.payload) {
        const payload = JSON.parse(mail.payload)
        const locale: Locale = payload._locale ?? 'de'
        const rendered = renderTemplate(mail.template, locale, payload)
        subject = rendered.subject
        html = rendered.html
        text = rendered.text
      }

      if (!subject) throw new Error('Mail has no subject (no template and no pre-rendered subject)')

      await transport.sendMail({
        from: mailFrom,
        to: mail.to_email,
        subject,
        html: html ?? undefined,
        text: text ?? undefined,
      })

      await execute(
        `UPDATE mail_queue SET status = 'done', updated_at = NOW() WHERE id = ?`,
        [mail.id]
      )
      broadcastEvent({ type: 'mail_queue_update', mailId: mail.id, status: 'done' })
    } catch (err: any) {
      console.error(`[mailer] Mail ${mail.id} failed:`, err.message)
      const newRetries = mail.retries + 1
      if (newRetries >= mail.max_retries) {
        await execute(
          `UPDATE mail_queue SET status = 'failed', retries = ?, error = ?, updated_at = NOW() WHERE id = ?`,
          [newRetries, err.message, mail.id]
        )
        broadcastEvent({ type: 'mail_queue_update', mailId: mail.id, status: 'failed', retries: newRetries, error: err.message })
      } else {
        await execute(
          `UPDATE mail_queue SET status = 'pending', retries = ?, error = ?, updated_at = NOW() WHERE id = ?`,
          [newRetries, err.message, mail.id]
        )
        broadcastEvent({ type: 'mail_queue_update', mailId: mail.id, status: 'pending', retries: newRetries, error: err.message })
      }
    }
  }
}
