import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './context/AuthContext'
import { I18nProvider } from './i18n/I18nContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
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
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import ProfilePage from './pages/ProfilePage'
import ImportPage from './pages/ImportPage'
import TldPricingPage from './pages/TldPricingPage'
import RegistrarsPage from './pages/RegistrarsPage'
import TemplatesPage from './pages/TemplatesPage'
import BillingSettingsPage from './pages/billing/SettingsPage'
import BillingDashboardPage from './pages/billing/DashboardPage'
import BillingItemsPage from './pages/billing/ItemsPage'
import ItemDetailPage from './pages/billing/ItemDetailPage'
import InvoicesPage from './pages/billing/InvoicesPage'
import InvoiceNewPage from './pages/billing/InvoiceNewPage'
import InvoiceDetailPage from './pages/billing/InvoiceDetailPage'
import PostalQueuePage from './pages/billing/PostalQueuePage'
import DunningQueuePage from './pages/billing/DunningQueuePage'
import PortalInvoicesPage from './pages/portal/PortalInvoicesPage'
import PortalInvoiceDetailPage from './pages/portal/PortalInvoiceDetailPage'

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
      INFORENT Prisma
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
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="domains" element={<DomainsLayout />}>
                <Route path=":name" element={<DomainDetailPage />} />
              </Route>
              <Route path="jobs" element={<JobsPage />} />
              <Route path="tenants" element={<TenantsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="audit-logs" element={<AuditLogPage />} />
              <Route path="mail-queue" element={<MailQueuePage />} />
              <Route path="tickets" element={<TicketsPage />}>
                <Route path=":id" element={<TicketDetailPage />} />
              </Route>
              <Route path="import" element={<ImportPage />} />
              <Route path="tld-pricing" element={<TldPricingPage />} />
              <Route path="registrars" element={<RegistrarsPage />} />
              <Route path="templates" element={<TemplatesPage />} />
              <Route path="billing/dashboard" element={<BillingDashboardPage />} />
              <Route path="billing/settings" element={<BillingSettingsPage />} />
              <Route path="billing/items" element={<BillingItemsPage />} />
              <Route path="billing/items/:id" element={<ItemDetailPage />} />
              <Route path="billing/invoices" element={<InvoicesPage />} />
              <Route path="billing/invoices/new" element={<InvoiceNewPage />} />
              <Route path="billing/invoices/:id" element={<InvoiceDetailPage />} />
              <Route path="billing/postal" element={<PostalQueuePage />} />
              <Route path="billing/dunning" element={<DunningQueuePage />} />
              <Route path="portal/invoices" element={<PortalInvoicesPage />} />
              <Route path="portal/invoices/:id" element={<PortalInvoiceDetailPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
      </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
    </I18nProvider>
  )
}
