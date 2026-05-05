import axios from 'axios'

// In production the web container proxies /api/v1 → api:3000/api/v1 via nginx.
// In local dev (npm run dev) set VITE_API_URL=http://localhost:3000 in web/.env.local
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1'

export const api = axios.create({
  baseURL: BASE,
  withCredentials: true,   // send httpOnly refresh_token cookie
})

// In-memory access token (never in localStorage)
let accessToken: string | null = null

type TokenListener = (t: string | null) => void
const tokenListeners = new Set<TokenListener>()

export function setAccessToken(token: string | null) {
  accessToken = token
  tokenListeners.forEach(l => l(token))
}

export function getAccessToken() {
  return accessToken
}

/**
 * Subscribe to access-token changes. Used by AuthContext so React state
 * (and `useWs`) stay in sync when the response interceptor silently refreshes
 * the token after a 401 — the interceptor lives outside React, so without
 * this notification the WebSocket would keep running on the stale token.
 */
export function onAccessTokenChange(listener: TokenListener): () => void {
  tokenListeners.add(listener)
  return () => { tokenListeners.delete(listener) }
}

// Attach access token to every request
api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

// On 401, try to refresh once, then retry original request
let refreshing: Promise<string | null> | null = null

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    // Never intercept the refresh endpoint itself — avoids infinite retry loop
    if (original.url?.includes('/auth/refresh')) return Promise.reject(error)
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      if (!refreshing) {
        refreshing = api
          .post<{ accessToken: string }>('/auth/refresh')
          .then((r) => {
            setAccessToken(r.data.accessToken)
            return r.data.accessToken
          })
          .catch(() => {
            setAccessToken(null)
            return null
          })
          .finally(() => { refreshing = null })
      }
      const newToken = await refreshing
      if (!newToken) return Promise.reject(error)
      original.headers.Authorization = `Bearer ${newToken}`
      return api(original)
    }
    return Promise.reject(error)
  }
)

// ── Typed API helpers ────────────────────────────────────────

export interface Label {
  id: number
  key: string
  value: string
  color?: string | null
  admin_only?: boolean
}

export interface Domain {
  id: number
  fqdn: string
  status: string
  zone_status: 'clean' | 'dirty' | 'error'
  last_serial: number
  last_rendered_at: string | null
  default_ttl: number
  tenant_id: number
  tenant_name: string
  created_at: string
  deleted_at: string | null
  reminder_flags: number
  labels: Label[]
  zone_error?: string | null
  dnssec_enabled: number
  dnssec_ds: string | null
  ns_ok: number | null
  ns_checked_at: string | null
  ns_observed: string | null
  expected_ns: string[]
  dnssec_ok: number | null
  dnssec_checked_at: string | null
  ns_reference: string | null
  templates: { id: number; name: string }[]
}

export interface DnsRecord {
  id: number
  domain_id: number
  name: string
  type: string
  ttl: number | null
  priority: number | null
  weight: number | null
  port: number | null
  value: string
  created_at: string
  updated_at: string
  _from_template?: boolean
  template_id?: number
}

export interface Tenant {
  id: number
  name: string
  company_name: string | null
  first_name: string | null
  last_name: string | null
  street: string | null
  zip: string | null
  city: string | null
  country: string | null
  phone: string | null
  fax: string | null
  email: string | null
  vat_id: string | null
  vat_id_valid: number | null
  vat_id_validated_at: string | null
  vat_id_check_name: string | null
  vat_id_check_address: string | null
  notes: string | null
  is_active: number
  created_at: string
  // Billing-Profil (Migration 027)
  billing_email: string | null
  tax_mode: 'standard' | 'reverse_charge' | 'small_business' | 'non_eu'
  tax_rate_percent_override: number | null
  payment_terms_days_override: number | null
  postal_delivery_default: number
  invoice_locale: 'de' | 'en'
  dunning_paused: number
  billing_notes: string | null
}

export interface User {
  id: number
  email: string
  full_name: string
  role: 'admin' | 'operator' | 'tenant'
  tenant_id: number | null
  tenant_ids: number[]
  is_active: number
  locale: 'en' | 'de'
  phone: string | null
  street: string | null
  zip: string | null
  city: string | null
  country: string | null
  created_at: string
  deleted_at?: string | null
}

export interface BulkJob {
  id: number
  operation: string
  status: string
  affected_domains: number
  processed_domains: number
  error: string | null
  preview_json: unknown
  created_at: string
  updated_at: string
}

export interface BulkJobDomain {
  id: number
  bulk_job_id: number
  domain_id: number
  fqdn: string
  status: string
  error: string | null
}

export interface ZoneRenderJob {
  id: number
  domain_id: number
  domain_name: string
  tenant_name: string
  priority: number
  retries: number
  max_retries: number
  status: 'pending' | 'processing' | 'done' | 'failed'
  error: string | null
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: number
  user_id: number | null
  domain_id: number | null
  entity_type: string
  action: string
  old_value: unknown
  new_value: unknown
  ip_address: string | null
  created_at: string
}

// Auth
export const login = (email: string, password: string) =>
  api.post<{ accessToken: string }>('/auth/login', { email, password })

export const logout = () => api.post('/auth/logout')

export const impersonateUser = (userId: number) =>
  api.post<{ accessToken: string }>(`/auth/impersonate/${userId}`)

export const stopImpersonation = () =>
  api.post<{ accessToken: string }>('/auth/stop-impersonation')

export const forgotPassword = (email: string) =>
  api.post<{ ok: true }>('/auth/forgot-password', { email })

export const validateResetToken = (token: string) =>
  api.get<{ email: string }>(`/auth/reset-password/${token}`)

export const resetPassword = (token: string, password: string) =>
  api.post<{ ok: true }>('/auth/reset-password', { token, password })

// Domains
export interface DomainStats {
  total: number; active: number; pending: number; suspended: number; deleted: number
  zone_error: number; zone_dirty: number
  ns_not_ok: number; dnssec_enabled: number; ns_ref: number
  top_tenants: { tenant_name: string; domain_count: number }[]
}
export const getDomainStats = () => api.get<DomainStats>('/domains/stats')

export const getDomains = (params?: Record<string, string>) =>
  api.get<Domain[]>('/domains', { params })

export const getDomain = (name: string) =>
  api.get<Domain>(`/domains/${name}`)

export const checkDomainSerial = (name: string | number, expected_serial: number) =>
  api.post<{ ok: true; current_serial: number }>(`/domains/${name}/check-serial`, { expected_serial })

export const checkDomainDnssec = (name: string | number) =>
  api.post<{ ok: boolean; dnssec_ok: number; checked_at: string }>(`/domains/${name}/check-dnssec`)

export const createDomain = (data: Partial<Domain>) =>
  api.post<Domain>('/domains', data)

export const updateDomain = (id: number, data: Partial<Domain>) =>
  api.put<Domain>(`/domains/${id}`, data)

export const deleteDomain = (id: number) =>
  api.delete(`/domains/${id}`)

export const restoreDomain = (id: number) =>
  api.post<Domain>(`/domains/${id}/restore`)

export const updateDomainLabels = (id: number, labels: Label[]) =>
  api.put<Label[]>(`/domains/${id}/labels`, { labels })

export interface LabelSuggestion {
  key: string
  values: string[]
  color: string | null
  admin_only: boolean
}

export const getLabelSuggestions = (tenantId?: number) =>
  api.get<LabelSuggestion[]>('/domains/labels', {
    params: tenantId != null ? { tenant_id: tenantId } : undefined,
  })

// Zone import
export interface ParsedImportRecord {
  name: string
  type: string
  ttl: number | null
  priority: number | null
  weight: number | null
  port: number | null
  value: string
}

export interface ImportConflict {
  existing: DnsRecord
  incoming: ParsedImportRecord
}

export interface ZoneImportParseResult {
  new: ParsedImportRecord[]
  conflicts: ImportConflict[]
  skipped: string[]
}

export const getZoneText = (domainId: number) =>
  api.get<{ text: string }>(`/domains/${domainId}/zone-text`)

export const parseZoneImport = (domainId: number, file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post<ZoneImportParseResult>(`/domains/${domainId}/zone-import/parse`, fd)
}

// Records
export const getRecords = (domainId: number) =>
  api.get<DnsRecord[]>(`/domains/${domainId}/records`)

export const createRecord = (domainId: number, data: Partial<DnsRecord>) =>
  api.post<DnsRecord>(`/domains/${domainId}/records`, data)

export const updateRecord = (domainId: number, id: number, data: Partial<DnsRecord>) =>
  api.put<DnsRecord>(`/domains/${domainId}/records/${id}`, data)

export const deleteRecord = (domainId: number, id: number) =>
  api.delete(`/domains/${domainId}/records/${id}`)

// DNS Check
export interface DnsCheckResolverResult {
  values: string[]
  error?: string
  unsupported?: true
}

export interface DnsCheckRow {
  name: string
  type: string
  answers: Record<string, DnsCheckResolverResult>
}

export interface DnsCheckResult {
  fqdn: string
  resolvers: string[]
  results: DnsCheckRow[]
}

export const dnsCheck = (domainId: number) =>
  api.get<DnsCheckResult>(`/domains/${domainId}/dns-check`).then(r => r.data)

// Tenants
export const getTenants = () => api.get<Tenant[]>('/tenants')
export const createTenant = (data: Partial<Tenant>) => api.post<Tenant>('/tenants', data)
export const updateTenant = (id: number, data: Partial<Tenant>) => api.put<Tenant>(`/tenants/${id}`, data)
export const deleteTenant = (id: number) => api.delete(`/tenants/${id}`)

// Users
export const getUsers = (opts?: { deleted?: boolean }) =>
  api.get<User[]>('/users', { params: opts?.deleted ? { deleted: 1 } : undefined })
export const createUser = (data: Partial<User> & { password: string }) => api.post<User>('/users', data)
export const updateUser = (id: number, data: Partial<User> & { password?: string; current_password?: string }) =>
  api.put<User>(`/users/${id}`, data)
export const deleteUser = (id: number) => api.delete<{ ok: true }>(`/users/${id}`)
export const restoreUser = (id: number) => api.post<User>(`/users/${id}/restore`)
export const adminResetUserPassword = (id: number) =>
  api.post<{ ok: true }>(`/users/${id}/reset-password`)

// Invites
export interface PendingInvite {
  id: number
  email: string
  full_name: string
  role: 'admin' | 'operator' | 'tenant'
  locale: 'en' | 'de'
  tenant_ids: number[]
  expires_at: string
  created_at: string
}

export const getInvites = () => api.get<PendingInvite[]>('/auth/invites')
export const revokeInvite = (id: number) => api.delete(`/auth/invites/${id}`)
export const inviteUser = (data: { email: string; full_name: string; role: string; locale: string; tenant_ids: number[] }) =>
  api.post('/auth/invite', data)
export const getInvite = (token: string) =>
  api.get<{ email: string; full_name: string; role: string; locale: string }>(`/auth/invite/${token}`)
export const acceptInvite = (data: { token: string; password: string }) =>
  api.post('/auth/accept-invite', data)

// Bulk jobs
export interface RecordSearchResult {
  id: number
  fqdn: string
  tenant_id: number
  tenant_name: string
  record_id: number
  record_name: string
  record_type: string
  ttl: number
  priority: number | null
  value: string
}

export const getZoneRenderQueue = () => api.get<ZoneRenderJob[]>('/zone-render-queue').then(r => r.data)
export const getBulkJobs = () => api.get<BulkJob[]>('/bulk-jobs')
export const createBulkJob = (data: object) => api.post<BulkJob>('/bulk-jobs', data)
export const previewBulkJob = (id: number) => api.post(`/bulk-jobs/${id}/preview`)
export const approveBulkJob = (id: number) => api.post(`/bulk-jobs/${id}/approve`)
export const getBulkJob = (id: number) => api.get(`/bulk-jobs/${id}`)
export const getBulkJobDomains = (id: number) => api.get(`/bulk-jobs/${id}/domains`)
export const searchByRecord = (params: { type: string; name?: string; value?: string }) =>
  api.get<RecordSearchResult[]>('/domains/search-by-record', { params })

// NS Status
export interface NsStatusEntry { ok: boolean; latencyMs: number | null; checkedAt: string }
export type NsStatus = Record<string, NsStatusEntry>
export const getNsStatus = () => api.get<NsStatus>('/ns-status')

// Audit logs
export interface AuditLogPage {
  data: AuditLog[]
  total: number
  page: number
  limit: number
  pages: number
  entityTypes: string[]
}

export const getAuditLogs = (params?: Record<string, string>) =>
  api.get<AuditLogPage>('/audit-logs', { params })

// Mail queue
export interface MailQueueItem {
  id: number
  to_email: string
  template: string | null
  status: 'pending' | 'processing' | 'done' | 'failed' | 'dismissed'
  retries: number
  max_retries: number
  error: string | null
  created_at: string
  updated_at: string
}

export interface MailQueuePage {
  data: MailQueueItem[]
  total: number
  page: number
  limit: number
  pages: number
  templates: string[]
}

export interface MailQueueDetail extends MailQueueItem {
  payload: unknown | null
  subject: string | null
  body_html: string | null
  body_text: string | null
  render_error: string | null
}

export const getMailQueue = (params?: Record<string, string>) =>
  api.get<MailQueuePage>('/mail-queue', { params })
export const getMailQueueItem = (id: number) =>
  api.get<MailQueueDetail>(`/mail-queue/${id}`)
export const retryMail = (id: number) => api.post(`/mail-queue/${id}/retry`)
export const dismissMail = (id: number) => api.post(`/mail-queue/${id}/dismiss`)
export const dismissAllFailedMail = () =>
  api.post<{ ok: true; dismissed: number }>('/mail-queue/dismiss-all-failed')

// Tickets
export interface Ticket {
  id: number
  subject: string
  status: 'open' | 'in_progress' | 'waiting' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  requester_email: string
  requester_name: string
  tenant_id: number | null
  assigned_to: number | null
  assigned_to_name: string | null
  source: 'web' | 'email'
  message_count: number
  created_at: string
  updated_at: string
}

export interface TicketAttachment {
  id: number
  ticket_id: number
  message_id: number | null
  original_name: string
  mime_type: string
  size: number
  created_by: number | null
  created_at: string
}

export interface TicketMessage {
  id: number
  ticket_id: number
  author_user_id: number | null
  author_name: string
  author_email: string
  body: string
  /** "reply" = user-written content; "event" = system entry, body is JSON metadata */
  kind: 'reply' | 'event'
  is_internal: 0 | 1
  source: 'web' | 'email'
  created_at: string
  attachments: TicketAttachment[]
}

export interface TicketStats {
  open: number
  by_priority: { urgent: number; high: number; normal: number; low: number }
}

export interface TicketDetail extends Ticket {
  messages: TicketMessage[]
}

export interface TicketListPage {
  data: Ticket[]
  total: number
  page: number
  limit: number
  pages: number
}

export const getTickets = (params?: Record<string, string>) =>
  api.get<TicketListPage>('/tickets', { params })

export const getTicketStats = () =>
  api.get<TicketStats>('/tickets/stats')

export const getTicket = (id: number) =>
  api.get<TicketDetail>(`/tickets/${id}`)

export const createTicket = (data: { subject: string; body: string; priority?: string }) =>
  api.post<{ id: number; messageId: number }>('/tickets', data)

export const updateTicket = (id: number, data: { status?: string; priority?: string; assigned_to?: number | null }) =>
  api.put(`/tickets/${id}`, data)

export const addTicketMessage = (id: number, data: { body: string; is_internal?: boolean }) =>
  api.post<{ id: number }>(`/tickets/${id}/messages`, data)

export const uploadAttachments = (ticketId: number, msgId: number, files: File[]) => {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  return api.post<TicketAttachment[]>(`/tickets/${ticketId}/messages/${msgId}/attachments`, fd)
}

// Import wizard
export type ImportStatus = 'insert' | 'update' | 'skip' | 'overwrite'

export interface ImportTenantRow {
  id: number
  name: string
  status: ImportStatus
}

export interface ImportTldPricingRow {
  zone: string
  tld: string
  description: string | null
  cost: number | null
  fee: number | null
  default_registrar: string | null
  note: string | null
  price_udr: number | null
  price_cn: number | null
  price_marcaria: number | null
  price_ud: number | null
  status: ImportStatus
}

export interface ImportDomainRow {
  fqdn: string
  tenant_id: number
  publish: number
  notes: string | null
  notes_internal: string | null
  cost_center: string | null
  brand: string | null
  ns_reference: string | null
  smtp_to: string | null
  spam_to: string | null
  add_fee: number | null
  we_registered: number
  flag: string | null
  status: ImportStatus
}

export interface ImportRecordRow {
  domain_fqdn: string
  name: string
  type: string
  priority: number | null
  value: string
  ttl: number | null
  status: 'overwrite'
}

export interface ImportPreviewResult {
  tenants: ImportTenantRow[]
  tld_pricing: ImportTldPricingRow[]
  domains: ImportDomainRow[]
  records: ImportRecordRow[]
}

export interface ImportSelection {
  tenant_ids?:   number[]
  tld_zones?:    string[]
  domain_fqdns?: string[]
  record_fqdns?: string[]
}

export interface ImportRunResult {
  tenants:    { inserted: number; updated: number }
  tld_pricing: { inserted: number; updated: number }
  domains:    { inserted: number; skipped: number }
  records:    { deleted: number; inserted: number }
}

// TLD Pricing
export interface TldPricing {
  zone: string
  tld: string
  description: string | null
  cost: number | null
  fee: number | null
  default_registrar: string | null
  note: string | null
  price_udr: number | null
  price_cn: number | null
  price_marcaria: number | null
  price_ud: number | null
  created_at: string
  updated_at: string
}

// Registrars
export interface Registrar {
  code: string
  name: string
  url: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export const getRegistrars = () =>
  api.get<Registrar[]>('/registrars')

export const createRegistrar = (data: Omit<Registrar, 'created_at' | 'updated_at'>) =>
  api.post<Registrar>('/registrars', data)

export const updateRegistrar = (code: string, data: Partial<Omit<Registrar, 'code' | 'created_at' | 'updated_at'>>) =>
  api.put<Registrar>(`/registrars/${encodeURIComponent(code)}`, data)

export const deleteRegistrar = (code: string) =>
  api.delete(`/registrars/${encodeURIComponent(code)}`)

export const getTldPricing = () =>
  api.get<TldPricing[]>('/tld-pricing')

export const createTldPricing = (data: Omit<TldPricing, 'created_at' | 'updated_at'>) =>
  api.post<TldPricing>('/tld-pricing', data)

export const updateTldPricing = (zone: string, data: Partial<Omit<TldPricing, 'zone' | 'created_at' | 'updated_at'>>) =>
  api.put<TldPricing>(`/tld-pricing/${encodeURIComponent(zone)}`, data)

export const deleteTldPricing = (zone: string) =>
  api.delete(`/tld-pricing/${encodeURIComponent(zone)}`)

export const getImportPreview = () =>
  api.get<ImportPreviewResult>('/import/preview')

export const runImport = (selection: ImportSelection) =>
  api.post<ImportRunResult>('/import/run', selection)

// ── DNS Templates ─────────────────────────────────────────────

export interface DnsTemplate {
  id: number
  tenant_id: number | null
  name: string
  description: string | null
  record_count: number
  created_at: string
  updated_at: string
}

export interface DnsTemplateRecord {
  id: number
  template_id: number
  name: string
  type: string
  ttl: number | null
  priority: number | null
  weight: number | null
  port: number | null
  value: string
}

export interface DnsTemplateDetail extends DnsTemplate {
  records: DnsTemplateRecord[]
}

export type ApplyMode = 'add_missing' | 'overwrite_matching' | 'replace_all'

export interface ApplyTemplateDiff {
  toAdd: DnsTemplateRecord[]
  toUpdate: { existing: DnsRecord; incoming: DnsTemplateRecord }[]
  toDelete: DnsRecord[]
}

export const getTemplates = () =>
  api.get<DnsTemplate[]>('/templates')

export const getTemplate = (id: number) =>
  api.get<DnsTemplateDetail>(`/templates/${id}`)

export const createTemplate = (data: { name: string; description?: string | null; tenant_id?: number | null }) =>
  api.post<DnsTemplate>('/templates', data)

export const updateTemplate = (id: number, data: { name?: string; description?: string | null }) =>
  api.put<DnsTemplate>(`/templates/${id}`, data)

export const deleteTemplate = (id: number) =>
  api.delete(`/templates/${id}`)

export const createTemplateRecord = (templateId: number, data: Partial<DnsTemplateRecord>) =>
  api.post<DnsTemplateRecord>(`/templates/${templateId}/records`, data)

export const updateTemplateRecord = (templateId: number, recordId: number, data: Partial<DnsTemplateRecord>) =>
  api.put<DnsTemplateRecord>(`/templates/${templateId}/records/${recordId}`, data)

export const deleteTemplateRecord = (templateId: number, recordId: number) =>
  api.delete(`/templates/${templateId}/records/${recordId}`)

export const previewApplyTemplate = (domainId: number, templateId: number, mode: ApplyMode) =>
  api.post<ApplyTemplateDiff>(`/domains/${domainId}/apply-template/preview`, { templateId, mode })

export const applyTemplate = (domainId: number, templateId: number, mode: ApplyMode) =>
  api.post<{ ok: boolean; added: number; updated: number; deleted: number }>(
    `/domains/${domainId}/apply-template`,
    { templateId, mode }
  )

export interface AssignedTemplate {
  id: number
  name: string
  description: string | null
  assigned_at: string
}

export const getDomainTemplates = (domainId: number) =>
  api.get<AssignedTemplate[]>(`/domains/${domainId}/templates`)

export const assignDomainTemplate = (domainId: number, templateId: number) =>
  api.post<{ ok: boolean; templateId: number; templateName: string }>(
    `/domains/${domainId}/templates`,
    { templateId }
  )

export const unassignDomainTemplate = (domainId: number, templateId: number) =>
  api.delete(`/domains/${domainId}/templates/${templateId}`)

export const downloadAttachment = async (ticketId: number, fileId: number, originalName: string) => {
  const resp = await api.get(`/tickets/${ticketId}/attachments/${fileId}`, { responseType: 'blob' })
  const url = URL.createObjectURL(resp.data)
  const a = document.createElement('a')
  a.href = url
  a.download = originalName
  a.click()
  URL.revokeObjectURL(url)
}

// ── Billing ─────────────────────────────────────────────────

export interface CompanySettings {
  id: number
  company_name: string
  address_line1: string
  address_line2: string | null
  zip: string
  city: string
  country: string
  phone: string | null
  email: string
  website: string | null
  tax_id: string | null
  vat_id: string | null
  commercial_register: string | null
  managing_director: string | null
  managing_director_ids: number[]
  bank_name: string
  iban: string
  bic: string
  account_holder: string
  default_currency: string
  default_payment_terms_days: number
  default_tax_rate_percent: number
  postal_fee_cents: number
  invoice_number_format: string
  invoice_footer_text: string | null
  logo_path: string | null
  auto_issue_drafts: boolean
  auto_issue_threshold_cents: number | null
  updated_at: string
}

export interface DunningLevel {
  level: number
  label: string
  days_after_due: number
  fee_cents: number
  template_key: string
}

export const getBillingSettings = () =>
  api.get<CompanySettings>('/billing/settings')

export const updateBillingSettings = (patch: Partial<CompanySettings>) =>
  api.patch<CompanySettings>('/billing/settings', patch)

export const getDunningLevels = () =>
  api.get<DunningLevel[]>('/billing/dunning-levels')

export const updateDunningLevel = (level: number, patch: Partial<Omit<DunningLevel, 'level'>>) =>
  api.patch<DunningLevel>(`/billing/dunning-levels/${level}`, patch)

export type BillingIntervalUnit =
  'second'|'minute'|'hour'|'day'|'week'|'month'|'year'|'lifetime'
export type BillingItemType = 'domain'|'dnssec'|'mail_forward'|'manual'|'usage'
export type BillingItemStatus = 'active'|'paused'|'cancelled'

export interface BillingItem {
  id: number
  tenant_id: number
  item_type: BillingItemType
  ref_table: string | null
  ref_id: number | null
  description: string
  description_template: string | null
  unit_price_cents: number
  tax_rate_percent: number | null
  currency: string
  interval_unit: BillingIntervalUnit
  interval_count: number
  started_at: string
  ends_at: string | null
  last_billed_until: string | null
  next_due_at: string | null
  status: BillingItemStatus
  notes: string | null
  created_by: number
  created_at: string
  updated_at: string
}

export type BillingItemCreate = Omit<BillingItem,
  'id'|'last_billed_until'|'next_due_at'|'created_by'|'created_at'|'updated_at'> & {
  started_at?: string
}

export const getBillingItems = (params?: { tenant_id?: number; status?: string; item_type?: string; ref_table?: string; ref_id?: number }) =>
  api.get<BillingItem[]>('/billing/items', { params })

export const getBillingItem = (id: number) =>
  api.get<BillingItem>(`/billing/items/${id}`)

export const createBillingItem = (data: Partial<BillingItemCreate>) =>
  api.post<BillingItem>('/billing/items', data)

export const updateBillingItem = (id: number, patch: Partial<BillingItemCreate>) =>
  api.patch<BillingItem>(`/billing/items/${id}`, patch)

export const deleteBillingItem = (id: number) =>
  api.delete<{ ok: true }>(`/billing/items/${id}`)

// ── Invoices ────────────────────────────────────────────────

export type InvoiceStatus = 'draft'|'issued'|'sent'|'paid'|'partial'|'overdue'|'cancelled'|'credit_note'
export type InvoiceKind = 'invoice'|'credit_note'|'dunning_invoice'

export interface InvoiceItem {
  id: number
  invoice_id: number
  billing_item_id: number | null
  position: number
  description: string
  period_start: string | null
  period_end: string | null
  quantity: number
  unit: string | null
  unit_price_cents: number
  tax_rate_percent: number
  line_subtotal_cents: number
  line_tax_cents: number
  line_total_cents: number
}

export interface Invoice {
  id: number
  invoice_number: string | null
  tenant_id: number
  status: InvoiceStatus
  kind: InvoiceKind
  original_invoice_id: number | null
  invoice_date: string | null
  service_period_start: string | null
  service_period_end: string | null
  due_date: string | null
  currency: string
  subtotal_cents: number
  tax_total_cents: number
  total_cents: number
  paid_cents: number
  tax_mode: 'standard' | 'reverse_charge' | 'small_business' | 'non_eu'
  tax_note: string | null
  postal_delivery: number
  postal_fee_cents: number
  pdf_path: string | null
  sent_at: string | null
  sent_via: 'email' | 'postal' | 'both' | 'none' | null
  billing_address_snapshot: any
  company_snapshot: any
  created_by: number
  cancelled_by: number | null
  cancelled_at: string | null
  cancellation_reason: string | null
  notes: string | null
  customer_notes: string | null
  created_at: string
  updated_at: string
  items?: InvoiceItem[]
}

export interface InvoiceItemInput {
  billing_item_id?: number | null
  position?: number
  description: string
  period_start?: string | null
  period_end?: string | null
  quantity: number
  unit?: string | null
  unit_price_cents: number
  tax_rate_percent: number
}

export interface InvoiceCreate {
  tenant_id: number
  kind?: InvoiceKind
  service_period_start?: string | null
  service_period_end?: string | null
  customer_notes?: string | null
  notes?: string | null
  postal_delivery?: boolean
  items?: InvoiceItemInput[]
}

export const getInvoices = (params?: { tenant_id?: number; status?: string; kind?: string; from?: string; to?: string }) =>
  api.get<Invoice[]>('/billing/invoices', { params })

export const getInvoice = (id: number) =>
  api.get<Invoice>(`/billing/invoices/${id}`)

export const createInvoice = (data: InvoiceCreate) =>
  api.post<Invoice>('/billing/invoices', data)

export const updateInvoice = (id: number, patch: Partial<Pick<Invoice, 'customer_notes'|'notes'|'service_period_start'|'service_period_end'>> & { postal_delivery?: boolean }) =>
  api.patch<Invoice>(`/billing/invoices/${id}`, patch)

export const addInvoiceItem = (invoiceId: number, item: InvoiceItemInput) =>
  api.post<Invoice>(`/billing/invoices/${invoiceId}/items`, item)

export const deleteInvoiceItem = (invoiceId: number, itemId: number) =>
  api.delete<Invoice>(`/billing/invoices/${invoiceId}/items/${itemId}`)

export const issueInvoice = (id: number) =>
  api.post<{ invoice_number: string; due_date: string; invoice: Invoice }>(`/billing/invoices/${id}/issue`)

export const cancelInvoice = (id: number, reason?: string) =>
  api.post<{ ok: true; hard_deleted?: true; credit_note?: Invoice }>(`/billing/invoices/${id}/cancel`, { reason })

// ── Payments / Dunning / Postal ─────────────────────────────

export interface Payment {
  id: number
  invoice_id: number
  paid_at: string
  amount_cents: number
  method: 'transfer'|'sepa'|'cash'|'card'|'manual'|'offset'
  reference: string | null
  notes: string | null
  created_by: number
  created_at: string
}

export const getInvoicePayments = (invoiceId: number) =>
  api.get<Payment[]>(`/billing/invoices/${invoiceId}/payments`)

export const createPayment = (invoiceId: number, body: {
  paid_at: string; amount_cents: number;
  method?: Payment['method']; reference?: string | null; notes?: string | null
}) => api.post<Payment>(`/billing/invoices/${invoiceId}/payments`, body)

export const deletePayment = (paymentId: number) =>
  api.delete<{ ok: true }>(`/billing/payments/${paymentId}`)

export interface DunningQueueRow {
  id: number
  invoice_number: string
  tenant_id: number
  tenant_name: string
  total_cents: number
  paid_cents: number
  due_date: string
  status: string
  dunning_paused: number
  days_overdue: number
  last_level: number
}
export const getDunningQueue = () => api.get<DunningQueueRow[]>('/billing/dunning/queue')

export interface PostalQueueRow {
  id: number
  invoice_number: string
  tenant_id: number
  tenant_name: string
  invoice_date: string
  due_date: string
  total_cents: number
  pdf_path: string | null
}
export const getPostalQueue = () => api.get<PostalQueueRow[]>('/billing/postal/queue')

export const markInvoicePrinted = (invoiceId: number) =>
  api.post<Invoice>(`/billing/invoices/${invoiceId}/mark-printed`)

export interface DunningLogEntry {
  id: number
  level: number
  sent_at: string
  fee_added_cents: number
  mail_queue_id: number | null
  pdf_path: string | null
  label: string
  template_key: string
}
export const getInvoiceDunning = (invoiceId: number) =>
  api.get<DunningLogEntry[]>(`/billing/invoices/${invoiceId}/dunning`)

// Dashboard
export interface BillingDashboardStats {
  mrr_cents: number
  arr_cents: number
  lifetime_active_count: number
  usage_active_count: number
  outstanding_cents: number
  open_count: number
  overdue_cents: number
  overdue_count: number
  this_month: { issued_count: number; issued_sum: number; paid_sum: number }
  trend: { bucket: string; count: number; sum_cents: number }[]
  top_overdue: { tenant_id: number; tenant_name: string; overdue_count: number; overdue_cents: number; oldest_due: string }[]
  recent: { id: number; invoice_number: string; tenant_id: number; tenant_name: string; invoice_date: string; total_cents: number; status: string; kind: string }[]
}
export const getBillingDashboardStats = () =>
  api.get<BillingDashboardStats>('/billing/dashboard/stats')

// VIES
export interface ViesResult {
  tenant_id: number
  vat_id: string
  valid: boolean
  name: string | null
  address: string | null
  checked_at: string
}
export const validateVatId = (tenantId: number) =>
  api.post<ViesResult>(`/billing/validate-vat-id/${tenantId}`)

// Pay-per-use
export interface UsageMetric {
  id: number
  billing_item_id: number
  recorded_at: string
  quantity: number
  metadata: Record<string, any> | null
  consumed_invoice_id: number | null
}

export interface UsageSummaryRow {
  bucket: string                  // YYYY-MM
  total_quantity: number
  data_points: number
  consumed_count: number
  sample_invoice_id: number | null
}

export const recordUsage = (body: {
  billing_item_id: number; quantity: number;
  recorded_at?: string; metadata?: Record<string, any>
}) => api.post<UsageMetric>('/billing/usage', body)

export const getItemUsage = (itemId: number, params?: { from?: string; to?: string; limit?: number }) =>
  api.get<UsageMetric[]>(`/billing/items/${itemId}/usage`, { params })

export const getItemUsageSummary = (itemId: number) =>
  api.get<UsageSummaryRow[]>(`/billing/items/${itemId}/usage/summary`)

export const deleteUsage = (id: number) =>
  api.delete<{ ok: true }>(`/billing/usage/${id}`)

export const triggerDunning = (invoiceId: number, level?: number) =>
  api.post<{ ok: true; level: number; dunning_invoice: Invoice | null; original: Invoice }>(
    `/billing/invoices/${invoiceId}/dunning`,
    level != null ? { level } : {}
  )

/**
 * Lädt das Rechnungs-PDF und öffnet es in einem neuen Tab. Bei 425 (PDF wird
 * noch generiert) wird ein freundlicher Hinweis ausgegeben.
 */
export async function openInvoicePdf(id: number): Promise<void> {
  try {
    const resp = await api.get(`/billing/invoices/${id}/pdf`, { responseType: 'blob' })
    const url = URL.createObjectURL(resp.data)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch (err: any) {
    if (err?.response?.status === 425) {
      alert('Das PDF wird gerade erzeugt — bitte in ein paar Sekunden erneut versuchen.')
    } else {
      throw err
    }
  }
}
