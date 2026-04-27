import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { I18nProvider } from './i18n/I18nContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DomainsLayout from './pages/DomainsLayout'
import DomainDetailPage from './pages/DomainDetailPage'
import JobsPage from './pages/JobsPage'
import TenantsPage from './pages/TenantsPage'
import UsersPage from './pages/UsersPage'
import AuditLogPage from './pages/AuditLogPage'
import MailQueuePage from './pages/MailQueuePage'
import TicketsPage from './pages/TicketsPage'
import TicketDetailPage from './pages/TicketDetailPage'
import AcceptInvitePage from './pages/AcceptInvitePage'
import ImportPage from './pages/ImportPage'
import TldPricingPage from './pages/TldPricingPage'
import RegistrarsPage from './pages/RegistrarsPage'
import TemplatesPage from './pages/TemplatesPage'

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 0,           // every query is always considered stale
      gcTime: 0,              // discard data immediately when no observers — no cross-mount cache
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
})

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth()
  if (!ready) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#9ca3af', fontSize: '.875rem' }}>
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
            <Route path="/accept-invite" element={<AcceptInvitePage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<Navigate to="/domains" replace />} />
              <Route path="domains" element={<DomainsLayout />}>
                <Route path=":name" element={<DomainDetailPage />} />
              </Route>
              <Route path="jobs" element={<JobsPage />} />
              <Route path="tenants" element={<TenantsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="audit-logs" element={<AuditLogPage />} />
              <Route path="mail-queue" element={<MailQueuePage />} />
              <Route path="tickets" element={<TicketsPage />} />
              <Route path="tickets/:id" element={<TicketDetailPage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="tld-pricing" element={<TldPricingPage />} />
              <Route path="registrars" element={<RegistrarsPage />} />
              <Route path="templates" element={<TemplatesPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/domains" replace />} />
          </Routes>
      </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
    </I18nProvider>
  )
}
