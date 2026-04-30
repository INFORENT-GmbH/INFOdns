import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { api, login as apiLogin, logout as apiLogout, setAccessToken, onAccessTokenChange, impersonateUser as apiImpersonate, stopImpersonation as apiStopImpersonate } from '../api/client'

interface AuthUser {
  sub: number
  role: 'admin' | 'operator' | 'tenant'
  tenantId: number | null
  impersonatingId?: number
}

interface AuthContextValue {
  user: AuthUser | null
  accessToken: string | null
  ready: boolean   // false until the initial silent refresh attempt completes
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  impersonate: (userId: number) => Promise<void>
  stopImpersonation: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function parseJwt(token: string): AuthUser {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(base64)) as AuthUser
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [accessToken, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  function applyToken(token: string) {
    setAccessToken(token)   // module-level for axios interceptors
    setToken(token)         // state for reactive consumers (useWs)
  }

  // On mount: attempt a silent token refresh using the httpOnly cookie.
  // If it succeeds the user is still logged in; if it fails they need to log in again.
  // Also subscribe to token changes from the axios interceptor: when a 401 triggers
  // a silent refresh inside client.ts, that path doesn't go through `applyToken`,
  // so without this subscription the React state (and `useWs`) would stay stale.
  useEffect(() => {
    const unsub = onAccessTokenChange((t) => {
      setToken(t)
      setUser(t ? parseJwt(t) : null)
    })
    api.post<{ accessToken: string }>('/auth/refresh')
      .then(res => {
        applyToken(res.data.accessToken)
        setUser(parseJwt(res.data.accessToken))
      })
      .catch(() => {
        // No valid session — user will be redirected to /login by RequireAuth
      })
      .finally(() => setReady(true))
    return unsub
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiLogin(email, password)
    applyToken(res.data.accessToken)
    setUser(parseJwt(res.data.accessToken))
  }, [])

  const logout = useCallback(async () => {
    await apiLogout().catch(() => {})
    setAccessToken(null)
    setToken(null)
    setUser(null)
  }, [])

  const impersonate = useCallback(async (userId: number) => {
    const res = await apiImpersonate(userId)
    applyToken(res.data.accessToken)
    setUser(parseJwt(res.data.accessToken))
  }, [])

  const stopImpersonation = useCallback(async () => {
    const res = await apiStopImpersonate()
    applyToken(res.data.accessToken)
    setUser(parseJwt(res.data.accessToken))
  }, [])

  return (
    <AuthContext.Provider value={{ user, accessToken, ready, login, logout, impersonate, stopImpersonation }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
