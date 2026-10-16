import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../hooks/useTheme'
import ThemeToggle from '../components/ThemeToggle'
import { authApi } from '../services/api'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [setupRequired, setSetupRequired] = useState(false)
  const [checkingSetup, setCheckingSetup] = useState(true)
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { isDark, toggle } = useTheme()

  const from = (location.state as { from?: string })?.from || '/'

  useEffect(() => {
    authApi.setupStatus()
      .then(({ setupRequired }) => setSetupRequired(setupRequired))
      .catch((err: Error) => setError(err.message || 'Não foi possível verificar a configuração inicial'))
      .finally(() => setCheckingSetup(false))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim()) {
      setError('Preencha todos os campos')
      return
    }
    if (setupRequired) {
      if (password.length < 12) {
        setError('A senha deve ter pelo menos 12 caracteres')
        return
      }
      if (password !== confirmPassword) {
        setError('As senhas não conferem')
        return
      }
    }
    setIsLoading(true)
    setError('')

    try {
      if (setupRequired) {
        await authApi.setup({ username: username.trim(), password })
        setSetupRequired(false)
      }

      const result = await login(username.trim(), password, rememberMe)
      if (result.success) {
        navigate(from, { replace: true })
      } else {
        setError(result.message || 'Erro ao fazer login')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao configurar o administrador')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 via-gray-50 to-gray-100 dark:from-gray-900 dark:via-gray-950 dark:to-gray-900 flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle isDark={isDark} onToggle={toggle} />
      </div>

      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center shadow-lg shadow-primary-500/25 mx-auto mb-4">
              <span className="text-white text-3xl">🏦</span>
            </div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-300 bg-clip-text text-transparent">
              {setupRequired ? 'Configuração inicial' : 'BenchRestoration'}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {setupRequired ? 'Crie a conta do primeiro administrador' : 'Bench Database Operations'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-sm rounded-lg p-3 border border-red-200 dark:border-red-800">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Usuário
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input w-full"
                placeholder="Digite seu usuário"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Senha
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input w-full"
                placeholder="Digite sua senha"
              />
            </div>

            {setupRequired && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Confirme a senha
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input w-full"
                  placeholder="Digite a senha novamente"
                  autoComplete="new-password"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Use pelo menos 12 caracteres.</p>
              </div>
            )}

            {!setupRequired && <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
              />
              <span>Lembrar senha por 7 dias</span>
            </label>}

            <button
              type="submit"
              disabled={isLoading || checkingSetup}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2"
            >
              {isLoading || checkingSetup ? (
                <span className="animate-spin">⏳</span>
              ) : (
                <span>🔑</span>
              )}
              {checkingSetup ? 'Verificando...' : isLoading ? (setupRequired ? 'Salvando...' : 'Entrando...') : setupRequired ? 'Criar administrador' : 'Entrar'}
            </button>
          </form>

          <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-6">
            BenchRestoration v2.0.0
          </p>
        </div>
      </div>
    </div>
  )
}
