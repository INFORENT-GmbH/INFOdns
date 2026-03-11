import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { I18nProvider } from './i18n/I18nContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DomainsPage from './pages/DomainsPage'
import DomainDetailPage from './pages/DomainDetailPage'
import BulkJobsPage from './pages/BulkJobsPage'
import JobsPage from './pages/JobsPage'
import CustomersPage from './pages/CustomersPage'
import UsersPage from './pages/UsersPage'
import AuditLogPage from './pages/AuditLogPage'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 10_000 } } })

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth()
  if (!ready) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui,sans-serif', color: '#9ca3af', fontSize: '.875rem' }}>
      INFOdns
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <I18nProvider>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
      <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="/domains" replace />} />
              <Route path="domains" element={<DomainsPage />} />
              <Route path="domains/:id" element={<DomainDetailPage />} />
              <Route path="bulk-jobs" element={<BulkJobsPage />} />
              <Route path="jobs" element={<JobsPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="audit-logs" element={<AuditLogPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/domains" replace />} />
          </Routes>
      </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
    </I18nProvider>
  )
}
