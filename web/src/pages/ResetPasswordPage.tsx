import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { validateResetToken, resetPassword } from '../api/client'
import { useI18n } from '../i18n/I18nContext'
import { formatApiError } from '../lib/formError'

type Status = 'loading' | 'ready' | 'submitting' | 'success' | 'error'
type ResetError = 'RESET_NOT_FOUND' | 'RESET_USED' | 'RESET_EXPIRED' | string

export default function ResetPasswordPage() {
  const { t, locale, setLocale } = useI18n()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [status, setStatus] = useState<Status>('loading')
  const [resetError, setResetError] = useState<ResetError | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) { setResetError('RESET_NOT_FOUND'); setStatus('error'); return }
    validateResetToken(token)
      .then(r => { setEmail(r.data.email); setStatus('ready') })
      .catch(err => {
        setResetError(err.response?.data?.code ?? 'RESET_NOT_FOUND')
        setStatus('error')
      })
  }, [token])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (password !== confirm) { setFormError(t('reset_mismatch')); return }
    setStatus('submitting')
    try {
      await resetPassword(token, password)
      setStatus('success')
    } catch (err: any) {
      const code = err.response?.data?.code
      if (code === 'RESET_USED' || code === 'RESET_EXPIRED' || code === 'RESET_NOT_FOUND') {
        setResetError(code)
        setStatus('error')
      } else {
        setFormError(formatApiError(err))
        setStatus('ready')
      }
    }
  }

  const errorMessage = () => {
    if (resetError === 'RESET_USED') return t('reset_error_used')
    if (resetError === 'RESET_EXPIRED') return t('reset_error_expired')
    return t('reset_error_notFound')
  }

  return (
    <div style={styles.wrapper}>
      <span style={styles.copyright}>&copy; 1988&ndash;2026 INFORENT GmbH</span>
      <button onClick={() => setLocale(locale === 'de' ? 'en' : 'de')} style={styles.langBtn}>
        {locale === 'de' ? 'EN' : 'DE'}
      </button>
      <div style={styles.card}>
        <img src="/inforent-original-logo.png" alt="INFORENT Prisma" style={styles.logo} />

        {status === 'loading' && <p style={styles.muted}>{t('loading')}</p>}

        {status === 'error' && (
          <>
            <p style={styles.error}>{errorMessage()}</p>
            <Link to="/forgot-password" style={styles.link}>{t('forgot_heading')}</Link>
            <Link to="/login" style={styles.link}>{t('login_backToLogin')}</Link>
          </>
        )}

        {status === 'success' && (
          <>
            <p style={styles.success}>{t('reset_success')}</p>
            <Link to="/login" style={styles.link}>{t('login_submit')}</Link>
          </>
        )}

        {(status === 'ready' || status === 'submitting') && (
          <>
            <h2 style={styles.heading}>{t('reset_heading')}</h2>
            {email && <p style={styles.emailLine}>{email}</p>}
            <form onSubmit={handleSubmit} style={styles.form}>
              {formError && <div style={styles.errorBox}>{formError}</div>}
              <label style={styles.label}>
                {t('reset_password')}
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
                {t('reset_confirmPassword')}
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
                {status === 'submitting' ? t('reset_submitting') : t('reset_submit')}
              </button>
            </form>
            <Link to="/login" style={styles.link}>{t('login_backToLogin')}</Link>
          </>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'url(/header-skyline.png) no-repeat bottom center, url(/background.jpg) no-repeat center center', backgroundSize: '800px 123px, cover', gap: '1rem' },
  langBtn: { position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '.25rem .6rem', cursor: 'pointer', fontSize: '.8rem' },
  copyright: { position: 'absolute', bottom: '1rem', right: '1rem', fontSize: '.75rem', color: '#9ca3af' },
  card: { background: '#fff', padding: '2rem', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,.12)', width: 360, display: 'flex', flexDirection: 'column', gap: '1rem' },
  logo: { height: 112, width: 'auto', alignSelf: 'center' },
  heading: { margin: 0, fontSize: '1.125rem', fontWeight: 600 },
  emailLine: { margin: 0, fontSize: '.875rem', color: '#6b7280' },
  form: { display: 'flex', flexDirection: 'column', gap: '.75rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500 },
  input: { padding: '.5rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '1rem' },
  btn: { padding: '.625rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
  errorBox: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.875rem' },
  error: { margin: 0, color: '#b91c1c', fontSize: '.875rem' },
  success: { margin: 0, padding: '.75rem', background: '#dcfce7', color: '#166534', borderRadius: 4, fontSize: '.875rem', lineHeight: 1.5 },
  muted: { margin: 0, color: '#9ca3af', fontSize: '.875rem' },
  link: { textAlign: 'center', color: '#2563eb', fontSize: '.875rem', textDecoration: 'none' },
}
