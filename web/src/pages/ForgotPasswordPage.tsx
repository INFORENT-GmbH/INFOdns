import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { forgotPassword } from '../api/client'
import { useI18n } from '../i18n/I18nContext'

export default function ForgotPasswordPage() {
  const { t, locale, setLocale } = useI18n()
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await forgotPassword(email)
    } catch {
      // Endpoint always returns 200 unless validation fails — treat any error as silent
    } finally {
      setLoading(false)
      setSubmitted(true)
    }
  }

  return (
    <div style={styles.wrapper}>
      <span style={styles.copyright}>&copy; 1988&ndash;2026 INFORENT GmbH</span>
      <button onClick={() => setLocale(locale === 'de' ? 'en' : 'de')} style={styles.langBtn}>
        {locale === 'de' ? 'EN' : 'DE'}
      </button>
      <form onSubmit={handleSubmit} style={styles.card}>
        <img src="/inforent-original-logo.png" alt="INFORENT Prisma" style={styles.logo} />
        <h2 style={styles.heading}>{t('forgot_heading')}</h2>
        {submitted ? (
          <p style={styles.success}>{t('forgot_success')}</p>
        ) : (
          <>
            <p style={styles.intro}>{t('forgot_intro')}</p>
            <label style={styles.label}>
              {t('login_email')}
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
                style={styles.input}
              />
            </label>
            <button type="submit" disabled={loading} style={styles.btn}>
              {loading ? t('forgot_submitting') : t('forgot_submit')}
            </button>
          </>
        )}
        <Link to="/login" style={styles.link}>{t('login_backToLogin')}</Link>
      </form>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'url(/header-skyline.png) no-repeat bottom center, url(/background.jpg) no-repeat center center', backgroundSize: '800px 123px, cover', gap: '1rem' },
  langBtn: { position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '.25rem .6rem', cursor: 'pointer', fontSize: '.8rem' },
  copyright: { position: 'absolute', bottom: '1rem', right: '1rem', fontSize: '.75rem', color: '#9ca3af' },
  card: { background: '#fff', padding: '2rem', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,.12)', width: 360, display: 'flex', flexDirection: 'column', gap: '1rem' },
  logo: { height: 112, width: 'auto', alignSelf: 'center' },
  heading: { margin: 0, fontSize: '1.125rem', fontWeight: 600, textAlign: 'center' },
  intro: { margin: 0, fontSize: '.875rem', color: '#374151', lineHeight: 1.5 },
  success: { margin: 0, padding: '.75rem', background: '#dcfce7', color: '#166534', borderRadius: 4, fontSize: '.875rem', lineHeight: 1.5 },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500 },
  input: { padding: '.5rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '1rem' },
  btn: { padding: '.625rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
  link: { textAlign: 'center', color: '#2563eb', fontSize: '.875rem', textDecoration: 'none' },
}
