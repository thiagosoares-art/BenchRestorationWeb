import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { authApi } from '../services/api'
import type { UserInfo } from '../types'

interface AuthContextType {
  user: UserInfo | null
  loading: boolean
  login: (username: string, password: string, rememberMe?: boolean) => Promise<{ success: boolean; message?: string }>
  logout: () => Promise<void>
  hasPermission: (permission: string) => boolean
  isAdmin: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authApi.me()
      .then(res => {
        if (res.success && res.user) setUser(res.user)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (username: string, password: string, rememberMe?: boolean) => {
    try {
      const res = await authApi.login({ username, password, rememberMe })
      if (res.success && res.user) {
        setUser(res.user)
        window.location.href = '/'
        return { success: true }
      }
      return { success: false, message: res.message || 'Usuário ou senha inválidos' }
    } catch (err: any) {
      return { success: false, message: err.message || 'Erro ao conectar ao servidor' }
    }
  }, [])

  const logout = useCallback(async () => {
    try { await authApi.logout() } catch {}
    setUser(null)
    window.location.href = '/login'
  }, [])

  const hasPermission = useCallback((permission: string) => {
    if (!user) return false
    if (user.role === 'Administrador') return true
    return user.permissions.includes(permission)
  }, [user])

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      hasPermission,
      isAdmin: user?.role === 'Administrador'
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
