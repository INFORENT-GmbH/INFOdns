import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDomains, createDomain, type Domain } from '../api/client'
import ZoneStatusBadge from '../components/ZoneStatusBadge'
import { useAuth } from '../context/AuthContext'

export default function DomainsPage() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newFqdn, setNewFqdn] = useState('')
  const [newCustomerId, setNewCustomerId] = useState('')
  const [creating, setCreating] = useState(false)

  const { data: domains = [], isLoading, error, refetch } = useQuery({
    queryKey: ['domains', search],
    queryFn: () => getDomains(search ? { search } : undefined).then(r => r.data),
  })

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      await createDomain({ fqdn: newFqdn, customer_id: Number(newCustomerId) as any })
      setNewFqdn('')
      setNewCustomerId('')
      setShowCreate(false)
      refetch()
    } catch (err: any) {
      alert(err.response?.data?.message ?? err.message)
    } finally {
      setCreating(false)
    }
  }

  const isAdminOrOp = user?.role === 'admin' || user?.role === 'operator'

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>Domains</h2>
        <div style={styles.headerRight}>
          <input
            placeholder="Search FQDN…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          {isAdminOrOp && (
            <button onClick={() => setShowCreate(v => !v)} style={styles.btnPrimary}>
              + Add Domain
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={styles.createForm}>
          <input
            placeholder="FQDN (e.g. example.com)"
            value={newFqdn}
            onChange={e => setNewFqdn(e.target.value)}
            required
            style={styles.input}
          />
          <input
            placeholder="Customer ID"
            type="number"
            value={newCustomerId}
            onChange={e => setNewCustomerId(e.target.value)}
            required
            style={{ ...styles.input, width: 120 }}
          />
          <button type="submit" disabled={creating} style={styles.btnPrimary}>
            {creating ? 'Creating…' : 'Create'}
          </button>
          <button type="button" onClick={() => setShowCreate(false)} style={styles.btnSecondary}>
            Cancel
          </button>
        </form>
      )}

      {isLoading && <p style={styles.muted}>Loading…</p>}
      {error && <p style={styles.errorText}>Failed to load domains</p>}

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>FQDN</th>
            <th style={styles.th}>Customer</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Zone</th>
            <th style={styles.th}>Serial</th>
            <th style={styles.th}>Last Rendered</th>
          </tr>
        </thead>
        <tbody>
          {domains.map((d: Domain) => (
            <tr key={d.id} style={styles.tr}>
              <td style={styles.td}>
                <Link to={`/domains/${d.id}`} style={styles.link}>{d.fqdn}</Link>
              </td>
              <td style={styles.td}>{d.customer_name}</td>
              <td style={styles.td}>{d.status}</td>
              <td style={styles.td}><ZoneStatusBadge status={d.zone_status} /></td>
              <td style={styles.td}><code>{d.last_serial || '—'}</code></td>
              <td style={styles.td}>
                {d.last_rendered_at
                  ? new Date(d.last_rendered_at).toLocaleString()
                  : <span style={styles.muted}>Never</span>}
              </td>
            </tr>
          ))}
          {!isLoading && domains.length === 0 && (
            <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', ...styles.muted }}>No domains found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  header: { display: 'flex', alignItems: 'center', marginBottom: '1rem' },
  headerRight: { marginLeft: 'auto', display: 'flex', gap: '.5rem', alignItems: 'center' },
  h2: { margin: 0, fontSize: '1.25rem', fontWeight: 700 },
  searchInput: { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', width: 240 },
  createForm: { display: 'flex', gap: '.5rem', marginBottom: '1rem', padding: '1rem', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' },
  input: { padding: '.375rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', flex: 1 },
  btnPrimary: { padding: '.375rem .875rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer' },
  btnSecondary: { padding: '.375rem .875rem', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '.5rem .75rem', background: '#f9fafb', borderBottom: '1px solid #e5e7eb', fontSize: '.75rem', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' },
  tr: { borderBottom: '1px solid #e5e7eb' },
  td: { padding: '.625rem .75rem', fontSize: '.875rem' },
  link: { color: '#2563eb', textDecoration: 'none', fontWeight: 500 },
  muted: { color: '#9ca3af' },
  errorText: { color: '#b91c1c' },
}
