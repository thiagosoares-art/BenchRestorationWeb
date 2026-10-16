import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'

interface TerminalEntry {
  text: string
  color: string
}

interface RestoreState {
  isRestoring: boolean
  terminalEntries: TerminalEntry[]
}

interface RestoreContextType extends RestoreState {
  setIsRestoring: (v: boolean) => void
  appendTerminal: (text: string, color?: string) => void
  updateTerminal: (marker: string, text: string, color?: string) => void
  clearTerminal: () => void
  cancelRestore: () => void
  restoreAbortRef: React.MutableRefObject<AbortController | null>
}

const RestoreContext = createContext<RestoreContextType | null>(null)

export function RestoreProvider({ children }: { children: ReactNode }) {
  const [isRestoring, setIsRestoring] = useState(false)
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([])
  const restoreAbortRef = useRef<AbortController | null>(null)

  const appendTerminal = useCallback((text: string, color: string = '#00d2ff') => {
    setTerminalEntries(prev => [...prev, { text, color }])
  }, [])

  const updateTerminal = useCallback((marker: string, text: string, color: string = '#00d2ff') => {
    setTerminalEntries(prev => {
      const idx = [...prev].reverse().findIndex(e => e.text.includes(marker))
      if (idx === -1) return [...prev, { text, color }]
      const target = prev.length - 1 - idx
      return prev.map((e, i) => (i === target ? { text, color } : e))
    })
  }, [])

  const clearTerminal = useCallback(() => {
    setTerminalEntries([])
  }, [])

  const cancelRestore = useCallback(() => {
    restoreAbortRef.current?.abort()
    restoreAbortRef.current = null
    setIsRestoring(false)
  }, [])

  return (
    <RestoreContext.Provider value={{ isRestoring, setIsRestoring, terminalEntries, appendTerminal, updateTerminal, clearTerminal, cancelRestore, restoreAbortRef }}>
      {children}
    </RestoreContext.Provider>
  )
}

export function useRestoreState() {
  const ctx = useContext(RestoreContext)
  if (!ctx) throw new Error('useRestoreState must be used within RestoreProvider')
  return ctx
}
