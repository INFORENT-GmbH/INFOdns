import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { getInvite, acceptInvite } from '../api/client'
import { useI18n } from '../i18n/I18nContext'

type Status = 'loading' | 'ready' | 'submitting' | 'success' | 'error'
type InviteError = 'INVITE_NOT_FOUND' | 'INVITE_USED' | 'INVITE_EXPIRED' | string

export default function AcceptInvitePage() {
  const { t } = useI18n()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [status, setStatus] = useState<Status>('loading')
  const [inviteError, setInviteError] = useState<InviteError | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFullName, setInviteFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setInviteError('INVITE_NOT_FOUND'); setStatus('error'); return }
    getInvite(token)
      .then(r => {
        setInviteEmail(r.data.email)
        setInviteFullName([r.data.first_name, r.data.last_name].filter(Boolean).join(' '))
        setStatus('ready')
      })
      .catch(err => {
        setInviteError(err.response?.data?.code ?? 'INVITE_NOT_FOUND')
        setStatus('error')
      })
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (password !== confirm) { setFormError(t('invite_mismatch')); return }
    setStatus('submitting')
    try {
      await acceptInvite({ token, password })
      setStatus('success')
    } catch (err: any) {
      const code = err.response?.data?.code
      if (code === 'INVITE_USED' || code === 'INVITE_EXPIRED' || code === 'INVITE_NOT_FOUND') {
        setInviteError(code)
        setStatus('error')
      } else {
        setFormError(err.response?.data?.message ?? err.message)
        setStatus('ready')
      }
    }
  }

  const errorMessage = () => {
    if (inviteError === 'INVITE_USED') return t('invite_error_used')
    if (inviteError === 'INVITE_EXPIRED') return t('invite_error_expired')
    return t('invite_error_notFound')
  }

  return (
    <div style={styles.outer}>
      <div style={styles.card}>
        <div style={styles.header}><h1 style={styles.logo}>INFOdns</h1></div>
        <div style={styles.body}>
          {status === 'loading' && <p style={styles.muted}>{t('loading')}</p>}

          {status === 'error' && (
            <>
              <p style={styles.errorMsg}>{errorMessage()}</p>
              <Link to="/login" style={styles.link}>{t('login_submit')}</Link>
            </>
          )}

          {status === 'success' && (
            <>
              <p style={styles.successMsg}>{t('invite_success')}</p>
              <Link to="/login" style={styles.link}>{t('login_submit')}</Link>
            </>
          )}

          {(status === 'ready' || status === 'submitting') && (
            <>
              <h2 style={styles.heading}>{t('invite_heading')}</h2>
              {inviteEmail && <p style={styles.emailLine}>{inviteEmail}{inviteFullName ? ` · ${inviteFullName}` : ''}</p>}
              <p style={styles.intro}>{t('invite_intro')}</p>
              <form onSubmit={handleSubmit} style={styles.form}>
                {formError && <div style={styles.errorBox}>{formError}</div>}
                <label style={styles.label}>
                  {t('invite_password')}
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoFocus
                    style={styles.input}
                  />
                </label>
                <label style={styles.label}>
                  {t('invite_confirmPassword')}
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    required
                    minLength={8}
                    style={styles.input}
                  />
                </label>
                <button type="submit" disabled={status === 'submitting'} style={styles.btn}>
                  {status === 'submitting' ? t('invite_submitting') : t('invite_submit')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  outer:      { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f5f7', padding: '1rem' },
  card:       { width: '100%', maxWidth: 420, background: '#fff', borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,.1)', overflow: 'hidden' },
  header:     { background: '#1e40af', padding: '20px 28px' },
  logo:       { margin: 0, color: '#fff', fontSize: 18, fontWeight: 700 },
  body:       { padding: '28px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' },
  heading:    { margin: '0 0 .5rem', fontSize: '1.125rem', fontWeight: 700 },
  emailLine:  { margin: '0 0 .75rem', fontSize: '.875rem', color: '#6b7280' },
  intro:      { margin: '0 0 1.25rem', fontSize: '.875rem', color: '#374151' },
  form:       { display: 'flex', flexDirection: 'column', gap: '.75rem' },
  label:      { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500, color: '#374151' },
  input:      { padding: '.5rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem', marginTop: 2 },
  btn:        { padding: '.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer', marginTop: '.25rem' },
  errorBox:   { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.875rem' },
  errorMsg:   { color: '#b91c1c', fontSize: '.875rem' },
  successMsg: { color: '#15803d', fontSize: '.875rem', marginBottom: '.75rem' },
  muted:      { color: '#9ca3af', fontSize: '.875rem' },
  link:       { color: '#2563eb', fontSize: '.875rem' },
}
