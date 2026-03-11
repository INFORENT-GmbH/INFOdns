import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
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
      setError('Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.wrapper}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h1 style={styles.title}>INFOdns</h1>
        <p style={styles.subtitle}>DNS Management</p>
        {error && <div style={styles.error}>{error}</div>}
        <label style={styles.label}>
          Email
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
          Password
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={styles.input}
          />
        </label>
        <button type="submit" disabled={loading} style={styles.btn}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f3f4f6' },
  card: { background: '#fff', padding: '2rem', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,.12)', width: 360, display: 'flex', flexDirection: 'column', gap: '1rem' },
  title: { margin: 0, fontSize: '1.5rem', fontWeight: 700 },
  subtitle: { margin: 0, color: '#6b7280', fontSize: '.875rem' },
  error: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.875rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500 },
  input: { padding: '.5rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '1rem' },
  btn: { padding: '.625rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '1rem', fontWeight: 600, cursor: 'pointer' },
}
