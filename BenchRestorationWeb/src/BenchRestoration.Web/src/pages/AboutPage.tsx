import Card from '../components/Card'

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Sobre o Sistema
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Informações sobre o BenchRestoration
        </p>
      </div>

      <Card>
        <div className="text-center py-6">
          <div className="w-24 h-24 bg-gradient-to-br from-primary-500 to-primary-700 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary-500/25">
            <span className="text-5xl">🏦</span>
          </div>

          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            BenchRestoration
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mb-8">
            Bench Database Operations
          </p>

          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Versão</span>
              <span className="font-semibold text-gray-900 dark:text-white">2.0.0 (Web)</span>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Plataforma</span>
              <span className="font-semibold text-gray-900 dark:text-white">.NET 10 + React</span>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Ambiente</span>
              <span className="font-semibold text-gray-900 dark:text-white">Rede Interna</span>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-4">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Atualização</span>
              <span className="font-semibold text-gray-900 dark:text-white">31/07/2026</span>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Convertido de desktop WPF para aplicação web.<br />
              Mantém todas as funcionalidades originais com interface moderna.
            </p>
          </div>

          <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
            Developed by Thiago F. Araújo Soares
          </p>

          <div className="mt-6 flex items-center justify-center gap-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="w-2 h-2 bg-green-500 rounded-full"></span>
              Sistema Operacional
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Windows 10 Pro • Versão 10.0.19045
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
