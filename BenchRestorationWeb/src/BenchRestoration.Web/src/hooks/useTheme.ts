import { useState, useEffect, useCallback } from 'react'
import { settingsApi } from '../services/api'

export function useTheme() {
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme')
      if (saved) return saved === 'dark'
      return window.matchMedia('(prefers-color-scheme: dark)').matches
    }
    return false
  })

  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
    localStorage.setItem('theme', isDark ? 'dark' : 'light')

    if (window.location.pathname !== '/login') {
      settingsApi.update({ Theme: isDark ? 'dark' : 'light' }).catch(() => {})
    }
  }, [isDark])

  useEffect(() => {
    if (window.location.pathname === '/login') return
    settingsApi.get()
      .then(settings => {
        if (settings.theme === 'dark' || settings.theme === 'light') {
          const stored = settings.theme === 'dark'
          setIsDark(stored)
        }
      })
      .catch(() => {})
  }, [])

  const toggle = useCallback(() => setIsDark(prev => !prev), [])

  return { isDark, toggle }
}
