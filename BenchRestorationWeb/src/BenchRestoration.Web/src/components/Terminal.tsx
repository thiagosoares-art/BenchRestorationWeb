import { useEffect, useRef, useState } from 'react'

interface TerminalEntry {
  text: string
  color: string
}

interface TerminalProps {
  entries: TerminalEntry[]
  onClear: () => void
}

export default function Terminal({ entries, onClear }: TerminalProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [entries])

  const copyLog = async () => {
    const text = entries.map(e => `> ${e.text}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="bg-gray-950 rounded-xl overflow-hidden border border-gray-800 h-full flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-900 to-gray-800 px-4 py-2.5 flex items-center justify-between border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500"></span>
            <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
            <span className="w-3 h-3 rounded-full bg-green-500"></span>
          </div>
          <span className="text-gray-400 text-xs font-medium ml-2">PowerShell</span>
        </div>
        <div className="flex items-center gap-2">
          {copied && (
            <span className="text-green-400 text-xs">Copiado!</span>
          )}
          {entries.length > 0 && (
            <button
              onClick={copyLog}
              className="text-gray-500 hover:text-gray-300 text-xs px-2 py-1 rounded hover:bg-gray-800 transition-colors"
            >
              Copiar
            </button>
          )}
          <button
            onClick={onClear}
            className="text-gray-500 hover:text-gray-300 text-xs px-2 py-1 rounded hover:bg-gray-800 transition-colors"
          >
            Limpar
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        ref={scrollRef}
        className="p-4 flex-1 overflow-y-auto font-mono text-sm min-h-[300px]"
      >
        {entries.length === 0 ? (
          <div className="text-gray-600 flex items-center gap-2">
            <span className="text-green-500">{'>'}</span>
            <span>Aguardando operação...</span>
            <span className="animate-pulse">_</span>
          </div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={index}
              className="py-0.5 flex items-start gap-2"
            >
              <span className="text-gray-600 select-none">{'>'}</span>
              <span style={{ color: entry.color }}>{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
