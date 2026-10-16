import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'

interface TerminalEntry {
  text: string
  color: string
}

export interface BatchItem {
  id: number
  databaseName: string
  status: 'Pendente' | 'Restaurando' | 'Concluido' | 'Erro'
  message: string
  backupFile?: string
  startTime?: string
  endTime?: string
}

interface BatchState {
  isProcessing: boolean
  batchItems: BatchItem[]
  currentBatchId: number
  terminalEntries: TerminalEntry[]
}

interface BatchContextType extends BatchState {
  setIsProcessing: (v: boolean) => void
  setBatchItems: (items: BatchItem[] | ((prev: BatchItem[]) => BatchItem[])) => void
  setCurrentBatchId: (id: number) => void
  appendTerminal: (text: string, color?: string) => void
  updateTerminal: (marker: string, text: string, color?: string) => void
  clearTerminal: () => void
  cancelBatch: () => void
  batchAbortRef: React.MutableRefObject<AbortController | null>
  isProcessingRef: React.MutableRefObject<boolean>
}

const BatchContext = createContext<BatchContextType | null>(null)

export function BatchProvider({ children }: { children: ReactNode }) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [currentBatchId, setCurrentBatchId] = useState(0)
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([])
  const batchAbortRef = useRef<AbortController | null>(null)
  const isProcessingRef = useRef(false)

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

  const cancelBatch = useCallback(() => {
    batchAbortRef.current?.abort()
    batchAbortRef.current = null
    isProcessingRef.current = false
    setIsProcessing(false)
    setCurrentBatchId(0)
  }, [])

  return (
    <BatchContext.Provider value={{
      isProcessing, setIsProcessing,
      batchItems, setBatchItems,
      currentBatchId, setCurrentBatchId,
      terminalEntries, appendTerminal, updateTerminal, clearTerminal,
      cancelBatch, batchAbortRef, isProcessingRef
    }}>
      {children}
    </BatchContext.Provider>
  )
}

export function useBatchState() {
  const ctx = useContext(BatchContext)
  if (!ctx) throw new Error('useBatchState must be used within BatchProvider')
  return ctx
}