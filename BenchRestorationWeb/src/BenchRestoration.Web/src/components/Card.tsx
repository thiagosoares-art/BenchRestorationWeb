import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  title?: string
  icon?: string
  description?: string
  className?: string
  headerAction?: ReactNode
}

export default function Card({ children, title, icon, description, className = '', headerAction }: CardProps) {
  return (
    <div className={`bg-white dark:bg-gray-800/50 rounded-xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 backdrop-blur-sm ${className}`}>
      {(title || icon || headerAction) && (
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {icon && (
                <div className="w-10 h-10 bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-900/50 dark:to-primary-800/50 rounded-xl flex items-center justify-center">
                  <span className="text-xl">{icon}</span>
                </div>
              )}
              {title && (
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
                  {description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
                  )}
                </div>
              )}
            </div>
            {headerAction}
          </div>
        </div>
      )}
      <div className="p-6">{children}</div>
    </div>
  )
}
