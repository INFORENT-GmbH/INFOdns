import nodemailer from 'nodemailer'

const SMTP_HOST = process.env.SMTP_HOST ?? ''
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 587)
const SMTP_USER = process.env.SMTP_USER ?? ''
const SMTP_PASS = process.env.SMTP_PASS ?? ''
const SMTP_FROM = process.env.SMTP_FROM ?? SMTP_USER
const MAIL_ADMIN_TO = process.env.MAIL_ADMIN_TO ?? ''

const transport = SMTP_HOST
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null

export async function sendJobMail(subject: string, text: string): Promise<void> {
  if (!transport || !MAIL_ADMIN_TO) return
  try {
    await transport.sendMail({ from: SMTP_FROM, to: MAIL_ADMIN_TO, subject, text })
  } catch (err: any) {
    console.error('[mailer] Failed to send email:', err.message)
  }
}
