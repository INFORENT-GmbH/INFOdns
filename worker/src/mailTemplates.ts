type Locale = 'en' | 'de'

interface MailContent {
  subject: string
  html: string
  text: string
}

// ── Base HTML wrapper ────────────────────────────────────────

function wrap(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { margin:0; padding:0; background:#f4f5f7; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#1f2937; }
  .outer { padding:32px 16px; }
  .card  { max-width:560px; margin:0 auto; background:#fff; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,.08); overflow:hidden; }
  .hdr   { background:linear-gradient(rgba(255,255,255,0.85),rgba(255,255,255,0.65)),url(${process.env.APP_PUBLIC_URL ?? ''}/header-skyline.png) no-repeat bottom center; background-size:auto,800px 123px; padding:16px 28px; border-bottom:1px solid #e5e7eb; }
  .hdr img { display:block; height:36px; width:auto; }
  .body  { padding:28px; line-height:1.6; font-size:14px; }
  .body h2 { margin:0 0 12px; font-size:16px; }
  .info  { background:#f9fafb; border:1px solid #e5e7eb; border-radius:6px; padding:14px 18px; margin:16px 0; }
  .info td { padding:4px 0; font-size:13px; }
  .info td:first-child { color:#6b7280; padding-right:16px; white-space:nowrap; }
  .ftr   { padding:20px 28px; font-size:12px; color:#9ca3af; border-top:1px solid #f3f4f6; }
  .ftr a  { color:#6b7280; }
</style>
</head>
<body>
<div class="outer">
<div class="card">
  <div class="hdr"><img src="${process.env.APP_PUBLIC_URL ?? ''}/logo-wide.png" alt="INFOdns"></div>
  <div class="body">${bodyHtml}</div>
  <div class="ftr">&copy; 1988&ndash;2026 INFORENT GmbH</div>
</div>
</div>
</body>
</html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function infoTable(rows: [string, string][]): string {
  const trs = rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td><strong>${esc(v)}</strong></td></tr>`).join('')
  return `<table class="info">${trs}</table>`
}

// ── Login notification ───────────────────────────────────────

interface LoginPayload {
  email: string
  ip: string
  userAgent: string
  timestamp: string
}

function loginNotification(locale: Locale, p: LoginPayload): MailContent {
  const isEn = locale === 'en'

  const subject = isEn
    ? 'New login to your INFOdns account'
    : 'Neue Anmeldung in Ihrem INFOdns-Konto'

  const heading = isEn ? 'New sign-in detected' : 'Neue Anmeldung erkannt'
  const intro = isEn
    ? `A new sign-in to your account (<strong>${esc(p.email)}</strong>) was detected.`
    : `Es wurde eine neue Anmeldung in Ihrem Konto (<strong>${esc(p.email)}</strong>) festgestellt.`
  const outro = isEn
    ? 'If this was you, no action is needed. If you did not sign in, please change your password immediately and contact your administrator.'
    : 'Wenn Sie sich selbst angemeldet haben, ist keine weitere Aktion erforderlich. Falls nicht, ändern Sie bitte umgehend Ihr Passwort und kontaktieren Sie Ihren Administrator.'

  const labels: Record<string, [string, string]> = {
    ip:        [isEn ? 'IP address'  : 'IP-Adresse',  p.ip],
    ua:        [isEn ? 'Browser'     : 'Browser',     p.userAgent],
    timestamp: [isEn ? 'Time'        : 'Zeitpunkt',   p.timestamp],
  }

  const bodyHtml = `<h2>${esc(heading)}</h2><p>${intro}</p>${infoTable(Object.values(labels))}<p>${outro}</p>`

  const text = [
    subject,
    '',
    intro.replace(/<[^>]+>/g, ''),
    '',
    ...Object.values(labels).map(([k, v]) => `${k}: ${v}`),
    '',
    outro,
  ].join('\n')

  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── Zone deploy success ──────────────────────────────────────

interface ZoneDeploySuccessPayload {
  fqdn: string
  jobId: number
  serial: number
  renderedAt: string
}

function zoneDeploySuccess(_locale: Locale, p: ZoneDeploySuccessPayload): MailContent {
  const subject = `[INFOdns] Zone deployed: ${p.fqdn}`
  const bodyHtml = `<h2>Zone deployed successfully</h2>` +
    infoTable([
      ['Domain', p.fqdn],
      ['Job ID', String(p.jobId)],
      ['Serial', String(p.serial)],
      ['Rendered at', p.renderedAt],
    ])
  const text = `Zone deployed: ${p.fqdn}\nJob: ${p.jobId}\nSerial: ${p.serial}\nRendered at: ${p.renderedAt}`
  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── Zone deploy failed ───────────────────────────────────────

interface ZoneDeployFailedPayload {
  fqdn: string
  jobId: number
  retries: number
  error: string
}

function zoneDeployFailed(_locale: Locale, p: ZoneDeployFailedPayload): MailContent {
  const subject = `[INFOdns] Zone deploy FAILED: ${p.fqdn}`
  const bodyHtml = `<h2 style="color:#b91c1c;">Zone deployment failed</h2>` +
    infoTable([
      ['Domain', p.fqdn],
      ['Job ID', String(p.jobId)],
      ['Retries', String(p.retries)],
      ['Error', p.error],
    ])
  const text = `Zone deploy FAILED: ${p.fqdn}\nJob: ${p.jobId}\nRetries: ${p.retries}\nError: ${p.error}`
  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── User invite ──────────────────────────────────────────────

interface UserInvitePayload {
  email: string
  full_name: string
  inviteUrl: string
}

function userInvite(locale: Locale, p: UserInvitePayload): MailContent {
  const isEn = locale === 'en'

  const subject = isEn
    ? 'You have been invited to INFOdns'
    : 'Sie wurden zu INFOdns eingeladen'

  const greeting = p.full_name
    ? (isEn ? `Hello ${esc(p.full_name)},` : `Hallo ${esc(p.full_name)},`)
    : (isEn ? 'Hello,' : 'Hallo,')

  const intro = isEn
    ? 'You have been invited to access <strong>INFOdns</strong>. Click the button below to set your password and activate your account.'
    : 'Sie wurden eingeladen, auf <strong>INFOdns</strong> zuzugreifen. Klicken Sie auf die Schaltfläche unten, um Ihr Passwort festzulegen und Ihr Konto zu aktivieren.'

  const buttonLabel = isEn ? 'Accept invitation' : 'Einladung annehmen'
  const expiry = isEn ? 'This link expires in 7 days.' : 'Dieser Link läuft in 7 Tagen ab.'
  const ignore = isEn
    ? 'If you did not expect this invitation, you can safely ignore this email.'
    : 'Wenn Sie diese Einladung nicht erwartet haben, können Sie diese E-Mail ignorieren.'

  const bodyHtml = `<h2>${esc(subject)}</h2>
<p>${greeting}</p>
<p>${intro}</p>
<p style="text-align:center;margin:24px 0">
  <a href="${esc(p.inviteUrl)}" style="background:#2563eb;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">${esc(buttonLabel)}</a>
</p>
<p style="font-size:12px;color:#6b7280">${expiry}<br>${ignore}</p>`

  const text = [
    subject, '', greeting, '',
    intro.replace(/<[^>]+>/g, ''), '',
    `${buttonLabel}: ${p.inviteUrl}`, '',
    expiry, ignore,
  ].join('\n')

  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── Ticket created ───────────────────────────────────────────

interface TicketCreatedPayload {
  ticketId: number
  subject: string
  requesterName: string
  portalUrl: string
}

function ticketCreated(locale: Locale, p: TicketCreatedPayload): MailContent {
  const isEn = locale === 'en'
  const ref = `[#${p.ticketId}]`
  const subject = isEn
    ? `Your support request has been received ${ref}`
    : `Ihre Supportanfrage wurde erhalten ${ref}`

  const greeting = p.requesterName
    ? (isEn ? `Hello ${esc(p.requesterName)},` : `Hallo ${esc(p.requesterName)},`)
    : (isEn ? 'Hello,' : 'Hallo,')

  const intro = isEn
    ? `We have received your support request and will get back to you shortly.`
    : `Wir haben Ihre Supportanfrage erhalten und werden uns in Kürze bei Ihnen melden.`

  const replyHint = isEn
    ? `You can reply to this email to add more information, or visit the support portal.`
    : `Sie können auf diese E-Mail antworten, um weitere Informationen hinzuzufügen, oder das Supportportal besuchen.`

  const bodyHtml = `<h2>${isEn ? 'Support request received' : 'Supportanfrage erhalten'}</h2>
<p>${greeting}</p>
<p>${intro}</p>
${infoTable([
  [isEn ? 'Ticket number' : 'Ticketnummer', ref],
  [isEn ? 'Subject' : 'Betreff', p.subject],
])}
<p>${replyHint}</p>`

  const text = [subject, '', greeting, '', intro, '', `Ticket: ${ref}`, `Subject: ${p.subject}`, '', replyHint].join('\n')
  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── Ticket reply ─────────────────────────────────────────────

interface TicketReplyPayload {
  ticketId: number
  subject: string
  staffName: string
  messageBody: string
  portalUrl: string
}

function ticketReply(locale: Locale, p: TicketReplyPayload): MailContent {
  const isEn = locale === 'en'
  const ref = `[#${p.ticketId}]`
  const subject = `Re: ${ref} ${p.subject}`

  const intro = isEn
    ? `${esc(p.staffName)} has replied to your support request ${ref}.`
    : `${esc(p.staffName)} hat auf Ihre Supportanfrage ${ref} geantwortet.`

  const bodyHtml = `<h2>${isEn ? 'New reply to your support request' : 'Neue Antwort auf Ihre Supportanfrage'}</h2>
<p>${intro}</p>
<div style="border-left:3px solid #2563eb;padding:8px 16px;margin:16px 0;background:#f0f7ff">
  <p style="margin:0;white-space:pre-wrap">${esc(p.messageBody)}</p>
</div>
<p style="font-size:12px;color:#6b7280">${isEn ? 'Reply to this email to respond.' : 'Antworten Sie auf diese E-Mail, um zu antworten.'}</p>`

  const text = [subject, '', intro, '', p.messageBody].join('\n')
  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── Ticket assigned ──────────────────────────────────────────

interface TicketAssignedPayload {
  ticketId: number
  subject: string
  requesterEmail: string
  priority: string
  portalUrl: string
}

function ticketAssigned(_locale: Locale, p: TicketAssignedPayload): MailContent {
  const ref = `[#${p.ticketId}]`
  const subject = `[INFOdns Support] Ticket ${ref} assigned to you`

  const bodyHtml = `<h2>Ticket assigned to you</h2>
<p>A support ticket has been assigned to you.</p>
${infoTable([
  ['Ticket', ref],
  ['Subject', p.subject],
  ['Requester', p.requesterEmail],
  ['Priority', p.priority],
])}`

  const text = [`Ticket ${ref} assigned to you`, '', `Subject: ${p.subject}`, `Requester: ${p.requesterEmail}`, `Priority: ${p.priority}`].join('\n')
  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── Ticket new (admin notification) ──────────────────────────

interface TicketNewAdminPayload {
  ticketId: number
  subject: string
  requesterName: string
  requesterEmail: string
  priority: string
  source: string
  portalUrl: string
}

function ticketNewAdmin(_locale: Locale, p: TicketNewAdminPayload): MailContent {
  const ref = `[#${p.ticketId}]`
  const subject = `[INFOdns Support] New ticket ${ref}: ${p.subject}`

  const bodyHtml = `<h2>New support ticket</h2>
<p>A new support ticket has been submitted.</p>
${infoTable([
  ['Ticket', ref],
  ['Subject', p.subject],
  ['From', `${esc(p.requesterName)} &lt;${esc(p.requesterEmail)}&gt;`],
  ['Priority', p.priority],
  ['Source', p.source],
])}
${p.portalUrl ? `<p><a href="${esc(p.portalUrl)}/tickets/${p.ticketId}">View ticket in portal</a></p>` : ''}`

  const text = [`New ticket ${ref}`, `Subject: ${p.subject}`, `From: ${p.requesterName} <${p.requesterEmail}>`, `Priority: ${p.priority}`, `Source: ${p.source}`, p.portalUrl ? `\n${p.portalUrl}/tickets/${p.ticketId}` : ''].join('\n')
  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── Domain deleted (admin notification) ──────────────────────

interface DomainDeletedPayload {
  fqdn: string
  deletedBy: string
  deletedAt: string
  purgeDate: string
}

function domainDeleted(_locale: Locale, p: DomainDeletedPayload): MailContent {
  const subject = `[INFOdns] Domain deleted: ${p.fqdn}`

  const bodyHtml = `<h2 style="color:#b91c1c;">Domain soft-deleted</h2>
<p>A domain has been soft-deleted and will be permanently purged if not restored.</p>
${infoTable([
  ['Domain', p.fqdn],
  ['Deleted by', p.deletedBy],
  ['Deleted on', p.deletedAt],
  ['Purge date', p.purgeDate],
])}
<p>Log in to INFOdns to restore the domain before the purge date.</p>`

  const text = [
    subject, '',
    `Domain ${p.fqdn} was soft-deleted by ${p.deletedBy} on ${p.deletedAt}.`,
    `It will be permanently purged on ${p.purgeDate} unless restored.`,
  ].join('\n')

  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── NS delegation OK ─────────────────────────────────────────

interface NsDelegationOkPayload {
  fqdn: string
}

function nsDelegationOk(_locale: Locale, p: NsDelegationOkPayload): MailContent {
  const subject = `[INFOdns] NS delegation OK: ${p.fqdn}`
  const bodyHtml = `<h2 style="color:#15803d;">NS delegation confirmed</h2>
<p>The name servers for the following domain now correctly point to this DNS service.</p>
${infoTable([['Domain', p.fqdn]])}`
  const text = `NS delegation OK: ${p.fqdn}\nThe domain's NS records now point to this DNS service.`
  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── NS delegation broken ──────────────────────────────────────

interface NsDelegationBrokenPayload {
  fqdn: string
}

function nsDelegationBroken(_locale: Locale, p: NsDelegationBrokenPayload): MailContent {
  const subject = `[INFOdns] NS delegation BROKEN: ${p.fqdn}`
  const bodyHtml = `<h2 style="color:#b91c1c;">NS delegation lost</h2>
<p>The name servers for the following domain no longer point to this DNS service.</p>
${infoTable([['Domain', p.fqdn]])}
<p>DNS queries for this domain may be answered by a different provider or fail entirely.</p>`
  const text = `NS delegation BROKEN: ${p.fqdn}\nThe domain's NS records no longer point to this DNS service.`
  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── Domain purge reminder (admin notification) ────────────────

interface DomainPurgeReminderPayload {
  fqdn: string
  daysRemaining: number
  deletedAt: string
  purgeDate: string
}

function domainPurgeReminder(_locale: Locale, p: DomainPurgeReminderPayload): MailContent {
  const urgent = p.daysRemaining <= 3
  const subject = `[INFOdns] ${urgent ? 'URGENT: ' : ''}Domain purge in ${p.daysRemaining} day${p.daysRemaining === 1 ? '' : 's'}: ${p.fqdn}`

  const bodyHtml = `<h2 style="color:${urgent ? '#b91c1c' : '#b45309'};">Permanent deletion reminder</h2>
<p>The following domain is scheduled for permanent deletion. All DNS records will be lost.</p>
${infoTable([
  ['Domain', p.fqdn],
  ['Deleted on', p.deletedAt],
  ['Days remaining', String(p.daysRemaining)],
  ['Purge date', p.purgeDate],
])}
<p>${urgent ? '<strong>Action required:</strong> ' : ''}Log in to INFOdns and restore the domain before ${p.purgeDate} to prevent permanent data loss.</p>`

  const text = [
    subject, '',
    `Domain ${p.fqdn} (deleted ${p.deletedAt}) will be permanently deleted in ${p.daysRemaining} day${p.daysRemaining === 1 ? '' : 's'} on ${p.purgeDate}.`,
    'Log in to INFOdns to restore it before then.',
  ].join('\n')

  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── DNSSEC OK ────────────────────────────────────────────────

interface DnssecOkPayload {
  fqdn: string
}

function dnssecOk(_locale: Locale, p: DnssecOkPayload): MailContent {
  const subject = `[INFOdns] DNSSEC OK: ${p.fqdn}`
  const bodyHtml = `<h2 style="color:#15803d;">DNSSEC signing confirmed</h2>
<p>The DNSKEY record for the following domain is now visible in public DNS.</p>
${infoTable([['Domain', p.fqdn]])}`
  const text = `DNSSEC OK: ${p.fqdn}\nThe DNSKEY record is now visible in public DNS.`
  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── DNSSEC broken ─────────────────────────────────────────────

interface DnssecBrokenPayload {
  fqdn: string
}

function dnssecBroken(_locale: Locale, p: DnssecBrokenPayload): MailContent {
  const subject = `[INFOdns] DNSSEC BROKEN: ${p.fqdn}`
  const bodyHtml = `<h2 style="color:#b91c1c;">DNSSEC signing lost</h2>
<p>The DNSKEY record for the following domain is no longer visible in public DNS.</p>
${infoTable([['Domain', p.fqdn]])}
<p>DNSSEC validation may fail for this domain until the signed zone propagates to all nameservers.</p>`
  const text = `DNSSEC BROKEN: ${p.fqdn}\nThe DNSKEY record is no longer visible in public DNS.`
  return { subject, html: wrap(subject, bodyHtml), text }
}

// ── Template registry ────────────────────────────────────────

const templates: Record<string, (locale: Locale, payload: any) => MailContent> = {
  login_notification: loginNotification,
  zone_deploy_success: zoneDeploySuccess,
  zone_deploy_failed: zoneDeployFailed,
  user_invite: userInvite,
  ticket_created: ticketCreated,
  ticket_reply: ticketReply,
  ticket_assigned: ticketAssigned,
  ticket_new_admin: ticketNewAdmin,
  domain_deleted: domainDeleted,
  domain_purge_reminder: domainPurgeReminder,
  ns_delegation_ok: nsDelegationOk,
  ns_delegation_broken: nsDelegationBroken,
  dnssec_ok: dnssecOk,
  dnssec_broken: dnssecBroken,
}

export function renderTemplate(template: string, locale: Locale, payload: unknown): MailContent {
  const fn = templates[template]
  if (!fn) throw new Error(`Unknown mail template: ${template}`)
  return fn(locale, payload as any)
}

export type { Locale, MailContent, LoginPayload, ZoneDeploySuccessPayload, ZoneDeployFailedPayload }
