import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAuditLogs, type AuditLog } from '../api/client'

const ACTIONS = ['', 'create', 'update', 'delete', 'bulk_apply']
const LIMIT = 50

export default function AuditLogPage() {
  const [filters, setFilters] = useState({ domain_id: '', user_id: '', action: '', from: '', to: '' })
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<number | null>(null)

  function setFilter(key: string, value: string) {
    setFilters(f => ({ ...f, [key]: value }))
    setPage(1)
  }

  const params: Record<string, string> = {
    page: String(page),
    limit: String(LIMIT),
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '')),
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit-logs', params],
    queryFn: () => getAuditLogs(params).then(r => r.data),
    placeholderData: (prev) => prev,
  })

  const logs: AuditLog[] = data?.data ?? []
  const totalPages = data?.pages ?? 1
  const total = data?.total ?? 0

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>Audit Log</h2>
        {total > 0 && (
          <span style={styles.totalBadge}>{total.toLocaleString()} entries</span>
        )}
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <input
          placeholder="Domain ID"
          value={filters.domain_id}
          onChange={e => setFilter('domain_id', e.target.value)}
          style={styles.filterInput}
        />
        <input
          placeholder="User ID"
          value={filters.user_id}
          onChange={e => setFilter('user_id', e.target.value)}
          style={styles.filterInput}
        />
        <select
          value={filters.action}
          onChange={e => setFilter('action', e.target.value)}
          style={{ ...styles.filterInput, width: 160 }}
        >
          {ACTIONS.map(a => (
            <option key={a} value={a}>{a || 'All actions'}</option>
          ))}
        </select>
        <input
          type="date"
          value={filters.from}
          onChange={e => setFilter('from', e.target.value)}
          style={styles.filterInput}
          title="From date"
        />
        <input
          type="date"
          value={filters.to}
          onChange={e => setFilter('to', e.target.value)}
          style={styles.filterInput}
          title="To date"
        />
        <button
          onClick={() => { setFilters({ domain_id: '', user_id: '', action: '', from: '', to: '' }); setPage(1) }}
          style={styles.btnSecondary}
        >
          Clear
        </button>
      </div>

      {isLoading ? (
        <p style={styles.muted}>Loading…</p>
      ) : (
        <>
          <table style={{ ...styles.table, opacity: isFetching ? 0.6 : 1 }}>
            <thead>
              <tr>
                <th style={styles.th}>Time</th>
                <th style={styles.th}>User</th>
                <th style={styles.th}>Action</th>
                <th style={styles.th}>Entity</th>
                <th style={styles.th}>Domain</th>
                <th style={styles.th}>IP</th>
                <th style={styles.th}>Changes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <>
                  <tr key={log.id} style={styles.tr}>
                    <td style={styles.tdMono}>{new Date(log.created_at).toLocaleString()}</td>
                    <td style={styles.td}>{log.user_id ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.td}><ActionBadge action={log.action} /></td>
                    <td style={styles.td}><code style={styles.code}>{log.entity_type}</code></td>
                    <td style={styles.td}>{log.domain_id ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.tdMono}>{log.ip_address ?? <span style={styles.muted}>—</span>}</td>
                    <td style={styles.td}>
                      {log.old_value || log.new_value ? (
                        <button
                          style={styles.diffToggle}
                          onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                        >
                          {expanded === log.id ? 'Hide' : 'View diff'}
                        </button>
                      ) : <span style={styles.muted}>—</span>}
                    </td>
                  </tr>
                  {expanded === log.id && (
                    <tr key={`${log.id}-diff`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td colSpan={7} style={{ padding: '0 .75rem .75rem' }}>
                        <div style={styles.diffGrid}>
                          {log.old_value != null && (
                            <div>
                              <div style={{ ...styles.diffLabel, color: '#b91c1c' }}>Before</div>
                              <pre style={{ ...styles.diffPre, borderColor: '#fecaca' }}>
                                {JSON.stringify(log.old_value, null, 2)}
                              </pre>
                            </div>
                          )}
                          {log.new_value != null && (
                            <div>
                              <div style={{ ...styles.diffLabel, color: '#15803d' }}>After</div>
                              <pre style={{ ...styles.diffPre, borderColor: '#bbf7d0' }}>
                                {JSON.stringify(log.new_value, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: '#9ca3af' }}>
                    No log entries found
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={styles.pagination}>
              <button
                style={styles.pageBtn}
                disabled={page === 1}
                onClick={() => setPage(1)}
              >
                «
              </button>
              <button
                style={styles.pageBtn}
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                ‹
              </button>
              <span style={styles.pageInfo}>
                Page {page} of {totalPages}
              </span>
              <button
                style={styles.pageBtn}
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                ›
              </button>
              <button
                style={styles.pageBtn}
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
              >
                »
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    create:     { bg: '#dcfce7', text: '#15803d' },
    update:     { bg: '#dbeafe', text: '#1d4ed8' },
    delete:     { bg: '#fee2e2', text: '#b91c1c' },
    bulk_apply: { bg: '#ede9fe', text: '#7c3aed' },
  }
  const c = colors[action] ?? { bg: '#f3f4f6', text: '#374151' }
  return (
    <span style={{ background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 12, fontSize: '.75rem', fontWeight: 600 }}>
      {action}
    </span>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header:      { display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' },
  h2:          { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  totalBadge:  { background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: 12, fontSize: '.75rem', fontWeight: 600 },
  filters:     { display: 'flex', gap: '.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' },
  filterInput: { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', width: 130 },
  btnSecondary:{ padding: '.375rem .875rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
  table:       { width: '100%', borderCollapse: 'collapse', transition: 'opacity .15s' },
  th:          { textAlign: 'left', padding: '.5rem .75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  tr:          { borderBottom: '1px solid #e5e7eb' },
  td:          { padding: '.5rem .75rem', fontSize: '.875rem', verticalAlign: 'middle' },
  tdMono:      { padding: '.5rem .75rem', fontSize: '.8125rem', fontFamily: 'monospace', verticalAlign: 'middle', color: '#374151' },
  code:        { background: '#f3f4f6', padding: '1px 5px', borderRadius: 3, fontSize: '.8125rem' },
  muted:       { color: '#9ca3af' },
  diffToggle:  { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '.8125rem', padding: 0, textDecoration: 'underline' },
  diffGrid:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' },
  diffLabel:   { fontSize: '.75rem', fontWeight: 600, marginBottom: '.25rem' },
  diffPre:     { fontSize: '.75rem', background: '#f9fafb', border: '1px solid', borderRadius: 4, padding: '.5rem', overflow: 'auto', maxHeight: 200, margin: 0 },
  pagination:  { display: 'flex', alignItems: 'center', gap: '.5rem', justifyContent: 'center', padding: '1rem 0' },
  pageBtn:     { padding: '.25rem .6rem', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: '.875rem' },
  pageInfo:    { fontSize: '.875rem', color: '#6b7280', padding: '0 .5rem' },
}
