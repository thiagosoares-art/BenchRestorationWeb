import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../contexts/AuthContext'
import ThemeToggle from './ThemeToggle'

const allNavItems = [
  { to: '/', label: 'Restaurar', icon: '🔄', permission: 'restaurar' },
  { to: '/history', label: 'Histórico', icon: '📋', permission: 'historico' },
  { to: '/batch', label: 'Lote', icon: '📦', permission: 'lote' },
  { to: '/delete', label: 'Excluir', icon: '🗑️', permission: 'excluir' },
  { to: '/queue', label: 'Fila', icon: '📋', permission: 'fila' },
  { to: '/server-size', label: 'Servidor', icon: '🖥️', permission: 'servidor' },
  { to: '/dashboard', label: 'Dashboard', icon: '📊', permission: 'dashboard' },
  { to: '/settings', label: 'Configurações', icon: '⚙️', permission: 'configuracoes' },
  { to: '/about', label: 'Sobre', icon: 'ℹ️', permission: '' },
]

export default function Layout() {
  const { isDark, toggle } = useTheme()
  const { user, logout, hasPermission } = useAuth()
  const navigate = useNavigate()

  const navItems = allNavItems.filter(item => !item.permission || hasPermission(item.permission))

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 dark:from-gray-900 dark:via-gray-950 dark:to-gray-900">
      {/* Header */}
      <header className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl border-b border-gray-200 dark:border-gray-700/50 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-6 lg:px-10">
          <div className="flex justify-between items-center h-16">
            {/* Logo and Title */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-lg shadow-primary-500/25">
                <span className="text-white text-xl">🏦</span>
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
                  BenchRestoration
                </h1>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Bench Database Operations
                </p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex items-center gap-1 bg-gray-100 dark:bg-gray-900 rounded-xl p-1">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                      isActive
                        ? 'bg-white dark:bg-gray-800 text-primary-600 dark:text-primary-400 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-white/50 dark:hover:bg-gray-800/50'
                    }`
                  }
                >
                  <span className="text-base">{item.icon}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </NavLink>
              ))}
            </nav>

            {/* User Info & Theme Toggle */}
            <div className="flex items-center gap-3">
              {user && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-900 rounded-lg">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {user.username}
                  </span>
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${
                    user.role === 'Administrador'
                      ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
                      : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {user.role}
                  </span>
                  <button
                    onClick={handleLogout}
                    className="text-gray-400 hover:text-red-500 transition-colors text-sm ml-1"
                    title="Sair"
                  >
                    ✕
                  </button>
                </div>
              )}
              <ThemeToggle isDark={isDark} onToggle={toggle} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-[1600px] mx-auto px-6 lg:px-10 py-6">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800 bg-white/50 dark:bg-gray-900/50 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto px-6 lg:px-10 py-4">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                Sistema Pronto
              </span>
              <span>Ambiente: {import.meta.env.DEV ? 'Desenvolvimento' : 'Produção'}</span>
            </div>
            <span>BenchRestoration v2.0.0</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
