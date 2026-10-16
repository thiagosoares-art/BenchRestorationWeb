import { ReactNode } from 'react'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string | ReactNode
  confirmLabel?: string
  loading?: boolean
  loadingLabel?: string
  onConfirm: () => void
  onCancel: () => void
  variant?: 'danger' | 'warning'
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirmar',
  loading = false,
  loadingLabel = 'Processando...',
  onConfirm,
  onCancel,
  variant = 'danger',
}: ConfirmDialogProps) {
  if (!isOpen) return null

  const buttonClass = variant === 'danger'
    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
    : 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500'

  const icon = variant === 'danger' ? '⚠️' : '❓'

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
        <div
          className="fixed inset-0 bg-gray-500/75 dark:bg-gray-900/75 backdrop-blur-sm transition-opacity"
          onClick={onCancel}
        />

        <div className="relative transform overflow-hidden rounded-2xl bg-white dark:bg-gray-800 text-left shadow-2xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
          <div className="px-6 pb-4 pt-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                variant === 'danger' ? 'bg-red-100 dark:bg-red-900/50' : 'bg-amber-100 dark:bg-amber-900/50'
              }`}>
                <span className="text-2xl">{icon}</span>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h3>
                <div className="mt-2">
                  {typeof message === 'string' ? (
                    <p className="text-sm text-gray-600 dark:text-gray-400">{message}</p>
                  ) : (
                    message
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50 flex flex-row-reverse gap-3">
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={`inline-flex justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${buttonClass} disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin">⏳</span>
                  {loadingLabel}
                </span>
              ) : (
                confirmLabel
              )}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className={`inline-flex justify-center rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
