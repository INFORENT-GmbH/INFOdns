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

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken() {
  return accessToken
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
            accessToken = r.data.accessToken
            return accessToken
          })
          .catch(() => {
            accessToken = null
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
  customer_id: number
  customer_name: string
  created_at: string
  deleted_at: string | null
  reminder_flags: number
  labels: Label[]
  zone_error?: string | null
  dnssec_enabled: number
  dnssec_ds: string | null
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
}

export interface Customer {
  id: number
  name: string
  is_active: number
  created_at: string
}

export interface User {
  id: number
  email: string
  full_name: string
  role: 'admin' | 'operator' | 'customer'
  customer_id: number | null
  customer_ids: number[]
  is_active: number
  locale: 'en' | 'de'
  created_at: string
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

// Domains
export const getDomains = (params?: Record<string, string>) =>
  api.get<Domain[]>('/domains', { params })

export const getDomain = (id: number) =>
  api.get<Domain>(`/domains/${id}`)

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

export const getLabelSuggestions = (customerId?: number) =>
  api.get<LabelSuggestion[]>('/domains/labels', {
    params: customerId != null ? { customer_id: customerId } : undefined,
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

// Customers
export const getCustomers = () => api.get<Customer[]>('/customers')
export const createCustomer = (data: Partial<Customer>) => api.post<Customer>('/customers', data)
export const updateCustomer = (id: number, data: Partial<Customer>) => api.put<Customer>(`/customers/${id}`, data)
export const deleteCustomer = (id: number) => api.delete(`/customers/${id}`)

// Users
export const getUsers = () => api.get<User[]>('/users')
export const createUser = (data: Partial<User> & { password: string }) => api.post<User>('/users', data)
export const updateUser = (id: number, data: Partial<User>) => api.put<User>(`/users/${id}`, data)

// Invites
export interface PendingInvite {
  id: number
  email: string
  full_name: string
  role: 'admin' | 'operator' | 'customer'
  locale: 'en' | 'de'
  customer_ids: number[]
  expires_at: string
  created_at: string
}

export const getInvites = () => api.get<PendingInvite[]>('/auth/invites')
export const revokeInvite = (id: number) => api.delete(`/auth/invites/${id}`)
export const inviteUser = (data: { email: string; full_name: string; role: string; locale: string; customer_ids: number[] }) =>
  api.post('/auth/invite', data)
export const getInvite = (token: string) =>
  api.get<{ email: string; full_name: string; role: string; locale: string }>(`/auth/invite/${token}`)
export const acceptInvite = (data: { token: string; password: string }) =>
  api.post('/auth/accept-invite', data)

// Bulk jobs
export const getBulkJobs = () => api.get<BulkJob[]>('/bulk-jobs')
export const createBulkJob = (data: object) => api.post<BulkJob>('/bulk-jobs', data)
export const previewBulkJob = (id: number) => api.post(`/bulk-jobs/${id}/preview`)
export const approveBulkJob = (id: number) => api.post(`/bulk-jobs/${id}/approve`)
export const getBulkJob = (id: number) => api.get(`/bulk-jobs/${id}`)
export const getBulkJobDomains = (id: number) => api.get(`/bulk-jobs/${id}/domains`)
export const searchByRecord = (params: { type: string; name?: string; value?: string }) =>
  api.get('/domains/search-by-record', { params })

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
}

export const getAuditLogs = (params?: Record<string, string>) =>
  api.get<AuditLogPage>('/audit-logs', { params })

// Mail queue
export interface MailQueueItem {
  id: number
  to_email: string
  template: string | null
  status: 'pending' | 'processing' | 'done' | 'failed'
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
}

export const getMailQueue = (params?: Record<string, string>) =>
  api.get<MailQueuePage>('/mail-queue', { params })
export const retryMail = (id: number) => api.post(`/mail-queue/${id}/retry`)

// Tickets
export interface Ticket {
  id: number
  subject: string
  status: 'open' | 'in_progress' | 'waiting' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  requester_email: string
  requester_name: string
  customer_id: number | null
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
  is_internal: number
  source: 'web' | 'email'
  created_at: string
  attachments: TicketAttachment[]
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

export const downloadAttachment = async (ticketId: number, fileId: number, originalName: string) => {
  const resp = await api.get(`/tickets/${ticketId}/attachments/${fileId}`, { responseType: 'blob' })
  const url = URL.createObjectURL(resp.data)
  const a = document.createElement('a')
  a.href = url
  a.download = originalName
  a.click()
  URL.revokeObjectURL(url)
}
