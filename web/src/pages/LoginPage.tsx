import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import logo from '../assets/logo.png'

export default function LoginPage() {
  const { login } = useAuth()
  const { t, locale, setLocale } = useI18n()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      navigate('/domains')
    } catch {
      setError(t('login_invalidCreds'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.wrapper}>
      <button onClick={() => setLocale(locale === 'de' ? 'en' : 'de')} style={styles.langBtn}>
        {locale === 'de' ? 'EN' : 'DE'}
      </button>
      <form onSubmit={handleSubmit} style={styles.card}>
        <img src={logo} alt="INFOdns" style={styles.logo} />
        {error && <div style={styles.error}>{error}</div>}
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
        <label style={styles.label}>
          {t('login_password')}
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={styles.input}
          />
        </label>
        <button type="submit" disabled={loading} style={styles.btn}>
          {loading ? t('login_submitting') : t('login_submit')}
        </button>
      </form>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f3f4f6', gap: '1rem' },
  langBtn: { position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: '1px solid #d1d5db', borderRadius: 4, padding: '.25rem .6rem', cursor: 'pointer', fontSize: '.8rem' },
  card: { background: '#fff', padding: '2rem', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,.12)', width: 360, display: 'flex', flexDirection: 'column', gap: '1rem' },
  logo: { height: 160, width: 'auto', alignSelf: 'flex-start' },
  subtitle: { margin: 0, color: '#6b7280', fontSize: '.875rem' },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.875rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500 },
  input: { padding: '.5rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '1rem' },
  btn: { padding: '.625rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
}
