import { useState, type FormEvent } from 'react'
import { updateUser } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import { formatApiError } from '../lib/formError'

export default function ProfilePage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  if (!user) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPassword !== confirm) { setError(t('reset_mismatch')); return }
    setLoading(true)
    try {
      await updateUser(user!.sub, { password: newPassword, current_password: currentPassword })
      setSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
    } catch (err: any) {
      const code = err.response?.data?.code
      if (code === 'CURRENT_PASSWORD_INVALID' || code === 'CURRENT_PASSWORD_REQUIRED') {
        setError(t('profile_currentPasswordWrong'))
      } else {
        setError(formatApiError(err))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.wrapper}>
      <h1 style={styles.title}>{t('profile_title')}</h1>

      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>{t('profile_changePassword')}</h2>
        <form onSubmit={handleSubmit} style={styles.form}>
          {error && <div style={styles.errorBox}>{error}</div>}
          {success && <div style={styles.successBox}>{t('profile_success')}</div>}
          <label style={styles.label}>
            {t('profile_currentPassword')}
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            {t('profile_newPassword')}
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            {t('profile_confirmPassword')}
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              style={styles.input}
            />
          </label>
          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? t('profile_saving') : t('profile_save')}
          </button>
        </form>
      </section>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: 480 },
  title: { margin: 0, fontSize: '1.25rem', fontWeight: 600 },
  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '1.25rem' },
  sectionTitle: { margin: '0 0 1rem', fontSize: '1rem', fontWeight: 600 },
  form: { display: 'flex', flexDirection: 'column', gap: '.75rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '.25rem', fontSize: '.875rem', fontWeight: 500, color: '#374151' },
  input: { padding: '.5rem .75rem', border: '1px solid #d1d5db', borderRadius: 4, fontSize: '.875rem' },
  btn: { padding: '.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: '.875rem', fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start', marginTop: '.25rem' },
  errorBox: { background: '#fee2e2', color: '#b91c1c', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.875rem' },
  successBox: { background: '#dcfce7', color: '#166534', padding: '.5rem .75rem', borderRadius: 4, fontSize: '.875rem' },
}
