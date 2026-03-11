import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getDomains, createDomain, type Domain } from '../api/client'
import ZoneStatusBadge from '../components/ZoneStatusBadge'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

export default function DomainsPage() {
  const { user } = useAuth()
  const { t } = useI18n()
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
        <h2 style={styles.h2}>{t('domains_title')}</h2>
        <div style={styles.headerRight}>
          <input
            placeholder={t('domains_searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          {isAdminOrOp && (
            <button onClick={() => setShowCreate(v => !v)} style={styles.btnPrimary}>
              {t('domains_addDomain')}
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={styles.createForm}>
          <input
            placeholder={t('domains_fqdnPlaceholder')}
            value={newFqdn}
            onChange={e => setNewFqdn(e.target.value)}
            required
            style={styles.input}
          />
          <input
            placeholder={t('domains_customerIdPlaceholder')}
            type="number"
            value={newCustomerId}
            onChange={e => setNewCustomerId(e.target.value)}
            required
            style={{ ...styles.input, width: 120 }}
          />
          <button type="submit" disabled={creating} style={styles.btnPrimary}>
            {creating ? t('creating') : t('create')}
          </button>
          <button type="button" onClick={() => setShowCreate(false)} style={styles.btnSecondary}>
            {t('cancel')}
          </button>
        </form>
      )}

      {isLoading && <p style={styles.muted}>{t('loading')}</p>}
      {error && <p style={styles.errorText}>{t('domains_loadError')}</p>}

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>FQDN</th>
            <th style={styles.th}>{t('customer')}</th>
            <th style={styles.th}>{t('status')}</th>
            <th style={styles.th}>{t('domains_zone')}</th>
            <th style={styles.th}>{t('serial')}</th>
            <th style={styles.th}>{t('domains_lastRendered')}</th>
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
                  : <span style={styles.muted}>{t('never')}</span>}
              </td>
            </tr>
          ))}
          {!isLoading && domains.length === 0 && (
            <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', ...styles.muted }}>{t('domains_noneFound')}</td></tr>
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
