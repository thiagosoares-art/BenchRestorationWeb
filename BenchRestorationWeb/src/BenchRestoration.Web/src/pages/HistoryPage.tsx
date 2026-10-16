import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { historyApi } from '../services/api'
import { useSignalR } from '../hooks/useSignalR'
import { useAuth } from '../contexts/AuthContext'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import ConfirmDialog from '../components/ConfirmDialog'
import { useState, useEffect, useMemo } from 'react'
import type { RestoreHistory, DeleteHistory } from '../types'

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins} min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `há ${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `há ${days}d`
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

function statusRowClass(status: string): string {
  switch (status) {
    case 'Erro': return 'bg-red-50/50 dark:bg-red-900/10'
    case 'Sucesso': return ''
    case 'EmAndamento': return 'bg-amber-50/50 dark:bg-amber-900/10'
    case 'Excluido': return ''
    case 'Bloqueado': return 'bg-orange-50/50 dark:bg-orange-900/10'
    default: return ''
  }
}

const statusIcons: Record<string, string> = {
  Sucesso: '✅',
  Erro: '❌',
  EmAndamento: '⏳',
  Cancelado: '🚫',
  Excluido: '🗑️',
  Bloqueado: '🛡️',
}

function azureStatusBadgeClass(status?: string): string {
  switch (status) {
    case 'Sucesso': return 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400'
    case 'Em andamento': return 'bg-cyan-100 dark:bg-cyan-900/50 text-cyan-700 dark:text-cyan-400'
    case 'Na fila': return 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400'
    case 'Parcial': return 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400'
    case 'Rejeitado': return 'bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400'
    case 'Cancelado': return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
    default: return 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400'
  }
}

type HistoryType = 'restore' | 'delete'

export default function HistoryPage() {
  const queryClient = useQueryClient()
  const { lastRestoreComplete } = useSignalR()
  const { isAdmin } = useAuth()
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [selectedHistory, setSelectedHistory] = useState<RestoreHistory | null>(null)
  const [selectedDeleteHistory, setSelectedDeleteHistory] = useState<DeleteHistory | null>(null)
  const [historyType, setHistoryType] = useState<HistoryType>('restore')
  const [searchTerm, setSearchTerm] = useState('')

  const { data: history = [], isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['history'],
    queryFn: () => historyApi.list(100),
  })

  const { data: deleteHistory = [], isLoading: isDeleteLoading, refetch: refetchDelete } = useQuery({
    queryKey: ['deleteHistory'],
    queryFn: () => historyApi.listDeletes(100),
  })

  // Auto-refresh when restore completes
  useEffect(() => {
    if (lastRestoreComplete) {
      refetch()
    }
  }, [lastRestoreComplete, refetch])

  const filteredHistory = useMemo(() => {
    if (historyType === 'restore') {
      if (!searchTerm.trim()) return history
      const term = searchTerm.toLowerCase()
      return history.filter(item =>
        item.databaseName.toLowerCase().includes(term) ||
        item.serverName.toLowerCase().includes(term) ||
        item.instanceName.toLowerCase().includes(term) ||
        (item.userName || '').toLowerCase().includes(term)
      )
    } else {
      if (!searchTerm.trim()) return deleteHistory
      const term = searchTerm.toLowerCase()
      return deleteHistory.filter(item =>
        item.databaseName.toLowerCase().includes(term) ||
        item.serverName.toLowerCase().includes(term) ||
        item.instanceName.toLowerCase().includes(term) ||
        (item.userName || '').toLowerCase().includes(term)
      )
    }
  }, [history, deleteHistory, historyType, searchTerm])

  const stats = useMemo(() => {
    if (historyType === 'restore') {
      const total = history.length
      const success = history.filter(h => h.status === 'Sucesso').length
      const error = history.filter(h => h.status === 'Erro').length
      const inProgress = history.filter(h => h.status === 'EmAndamento').length
      return { total, success, error, inProgress }
    } else {
      const total = deleteHistory.length
      const success = deleteHistory.filter(h => h.status === 'Excluido').length
      const error = deleteHistory.filter(h => h.status === 'Erro').length
      const blocked = deleteHistory.filter(h => h.status === 'Bloqueado').length
      return { total, success, error, inProgress: blocked }
    }
  }, [history, deleteHistory, historyType])

  const handleSwitchType = (type: HistoryType) => {
    setHistoryType(type)
    setSelectedHistory(null)
    setSelectedDeleteHistory(null)
    setSearchTerm('')
  }

  const handleSaveHistory = () => {
    const payload = {
      geradoEm: new Date().toISOString(),
      restauracoes: history,
      exclusoes: deleteHistory,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `historico-operacoes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('Histórico salvo com sucesso!')
  }

  const [isRefreshingAzure, setIsRefreshingAzure] = useState(false)

  const handleRefreshAzure = async () => {
    try {
      setIsRefreshingAzure(true)
      const result = await historyApi.refreshAzureStatus()
      toast.success(result.message)
      queryClient.invalidateQueries({ queryKey: ['history'] })
    } catch (error: any) {
      toast.error(error.message || 'Erro ao verificar status Azure')
    } finally {
      setIsRefreshingAzure(false)
    }
  }

  const handleClear = async () => {
    if (historyType === 'restore') {
      await historyApi.clear()
      queryClient.invalidateQueries({ queryKey: ['history'] })
      setSelectedHistory(null)
    } else {
      await historyApi.clearDeletes()
      queryClient.invalidateQueries({ queryKey: ['deleteHistory'] })
      setSelectedDeleteHistory(null)
    }
    setShowClearConfirm(false)
  }

  const isLoadingData = historyType === 'restore' ? isLoading : isDeleteLoading

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Histórico de Operações
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Visualize e acompanhe as operações de restauração e exclusão
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => (historyType === 'restore' ? refetch() : refetchDelete())}
            disabled={isRefetching}
            className="btn-secondary flex items-center gap-2"
          >
            <span className={`inline-block ${isRefetching ? 'animate-spin' : ''}`}>
              {isRefetching ? '⏳' : '🔄'}
            </span>
            Atualizar
          </button>
          <button
            onClick={handleSaveHistory}
            className="btn-secondary flex items-center gap-2"
            title="Baixar todo o histórico (restauração e exclusão) em JSON"
          >
            💾 Salvar Histórico
          </button>
          {historyType === 'restore' && (
            <button
              onClick={handleRefreshAzure}
              disabled={isRefreshingAzure}
              className="btn-secondary flex items-center gap-2"
              title="Verifica o status atual das pipelines Azure DevOps que estão como 'Em andamento' e atualiza o histórico"
            >
              <span className={`inline-block ${isRefreshingAzure ? 'animate-spin' : ''}`}>
                {isRefreshingAzure ? '⏳' : '☁️'}
              </span>
              Status Azure
            </button>
          )}
          {isAdmin && (historyType === 'restore' ? history.length > 0 : deleteHistory.length > 0) && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="btn-danger flex items-center gap-2"
            >
              🗑️ Limpar Histórico
            </button>
          )}
        </div>
      </div>

      {/* History Type Selector */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-1 inline-flex">
        <button
          onClick={() => handleSwitchType('restore')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            historyType === 'restore'
              ? 'bg-primary-600 text-white shadow'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          🔄 Restauração
        </button>
        <button
          onClick={() => handleSwitchType('delete')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            historyType === 'delete'
              ? 'bg-red-600 text-white shadow'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          🗑️ Exclusão
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Total</div>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800 p-4">
          <div className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{stats.success}</div>
          <div className="text-xs text-emerald-600 dark:text-emerald-500 mt-1">
            {historyType === 'restore' ? 'Sucesso' : 'Excluídos'}
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 p-4">
          <div className="text-2xl font-bold text-red-700 dark:text-red-400">{stats.error}</div>
          <div className="text-xs text-red-600 dark:text-red-500 mt-1">Erro</div>
        </div>
        <div className={`rounded-xl border p-4 ${historyType === 'restore'
          ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
          : 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'}`}>
          <div className={`text-2xl font-bold ${historyType === 'restore' ? 'text-amber-700 dark:text-amber-400' : 'text-orange-700 dark:text-orange-400'}`}>{stats.inProgress}</div>
          <div className={`text-xs mt-1 ${historyType === 'restore' ? 'text-amber-600 dark:text-amber-500' : 'text-orange-600 dark:text-orange-500'}`}>
            {historyType === 'restore' ? 'Em Andamento' : 'Bloqueados'}
          </div>
        </div>
      </div>

      {/* Content: Table + Detail Panel */}
      <div className="grid grid-cols-1 gap-6">
        {/* Table (full width) */}
        <Card>
          {/* Search */}
          <div className="mb-4">
            <input
              type="text"
              placeholder="Buscar por banco, servidor, instância ou usuário..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

            {isLoadingData ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <span className="ml-3 text-gray-500">Carregando...</span>
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="text-center py-12">
                {searchTerm ? (
                  <>
                    <span className="text-5xl mb-4 block">🔍</span>
                    <p className="text-gray-500 dark:text-gray-400">Nenhum registro encontrado para "{searchTerm}"</p>
                  </>
                ) : historyType === 'restore' ? (
                  <>
                    <span className="text-5xl mb-4 block">📋</span>
                    <p className="text-gray-500 dark:text-gray-400">Nenhuma restauração registrada</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">As restaurações realizadas aparecerão aqui</p>
                  </>
                ) : (
                  <>
                    <span className="text-5xl mb-4 block">🗑️</span>
                    <p className="text-gray-500 dark:text-gray-400">Nenhuma exclusão registrada</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">As exclusões realizadas aparecerão aqui</p>
                  </>
                )}
              </div>
            ) : historyType === 'restore' ? (
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-white dark:bg-gray-800 z-10">
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">#</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Data/Hora</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Servidor</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Banco</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Usuário</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Duração</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Azure</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {(filteredHistory as RestoreHistory[]).map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => { setSelectedHistory(item); setSelectedDeleteHistory(null) }}
                        className={`cursor-pointer transition-colors ${statusRowClass(item.status)} ${
                          selectedHistory?.id === item.id
                            ? 'ring-2 ring-primary-500 ring-inset'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}
                      >
                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.id}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                          <span title={item.startedAt ? new Date(item.startedAt).toLocaleString('pt-BR') : ''}>
                            {item.startedAt ? (
                              <span className="flex flex-col">
                                <span>{new Date(item.startedAt).toLocaleString('pt-BR')}</span>
                                <span className="text-xs text-gray-400">{relativeTime(item.startedAt)}</span>
                              </span>
                            ) : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="text-gray-600 dark:text-gray-300">{item.serverName}</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 block">{item.instanceName}</span>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                          {item.databaseName}
                          {item.backupFile && (
                            <span className="text-xs text-gray-400 dark:text-gray-500 block truncate max-w-[200px]" title={item.backupFile}>
                              {item.backupFile.split('\\').pop()}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                          {item.userName || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono">
                          {item.duration ? (
                            <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-xs">
                              {item.duration}
                            </span>
                          ) : item.status === 'EmAndamento' ? (
                            <span className="text-amber-500">em execução...</span>
                          ) : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {item.triggeredAzure ? (
                            <span className="flex flex-wrap items-center gap-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${azureStatusBadgeClass(item.azureStatus)}`} title={item.azureReleaseId ? `Release #${item.azureReleaseId}` : ''}>
                                {item.azureStatus || 'Disparado'}
                              </span>
                              {item.azureReleaseId && (
                                <span className="text-xs text-emerald-600 dark:text-emerald-400">#{item.azureReleaseId}</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm"><StatusBadge status={item.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-white dark:bg-gray-800 z-10">
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">#</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Data/Hora</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Servidor</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Banco</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Usuário</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {(filteredHistory as DeleteHistory[]).map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => { setSelectedDeleteHistory(item); setSelectedHistory(null) }}
                        className={`cursor-pointer transition-colors ${statusRowClass(item.status)} ${
                          selectedDeleteHistory?.id === item.id
                            ? 'ring-2 ring-red-500 ring-inset'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}
                      >
                        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{item.id}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                          <span title={item.deletedAt ? new Date(item.deletedAt).toLocaleString('pt-BR') : ''}>
                            {item.deletedAt ? (
                              <span className="flex flex-col">
                                <span>{new Date(item.deletedAt).toLocaleString('pt-BR')}</span>
                                <span className="text-xs text-gray-400">{relativeTime(item.deletedAt)}</span>
                              </span>
                            ) : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <span className="text-gray-600 dark:text-gray-300">{item.serverName}</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500 block">{item.instanceName}</span>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                          {item.databaseName}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                          {item.userName || '-'}
                        </td>
                        <td className="px-4 py-3 text-sm"><StatusBadge status={item.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

        {/* Detail Panel (full width) */}
        <div>
          <Card
            title="Detalhes"
            icon="📋"
            description={
              historyType === 'restore'
                ? selectedHistory ? `Registro #${selectedHistory.id}` : 'Selecione um registro'
                : selectedDeleteHistory ? `Registro #${selectedDeleteHistory.id}` : 'Selecione um registro'
            }
          >
            {historyType === 'restore' ? (
              selectedHistory ? (
                <div className="space-y-4">
                  {/* Status Header */}
                  <div className="flex items-center gap-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                    <span className="text-2xl">{statusIcons[selectedHistory.status] || '📋'}</span>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white">{selectedHistory.databaseName}</div>
                      <StatusBadge status={selectedHistory.status} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* User Info */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">👤 Usuário</h4>
                      <DetailRow label="Restauração feita por" value={selectedHistory.userName || '-'} />
                    </div>

                    {/* Server Info */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">🖥️ Servidor</h4>
                      <DetailRow label="Servidor" value={selectedHistory.serverName} />
                      <DetailRow label="Instância" value={selectedHistory.instanceName} />
                    </div>

                    {/* Timing */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">⏱️ Tempo</h4>
                      <DetailRow label="Início" value={selectedHistory.startedAt ? new Date(selectedHistory.startedAt).toLocaleString('pt-BR') : '-'} />
                      <DetailRow label="Fim" value={selectedHistory.finishedAt ? new Date(selectedHistory.finishedAt).toLocaleString('pt-BR') : '-'} />
                      <DetailRow label="Duração" value={
                        selectedHistory.duration
                          ? <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded font-mono">{selectedHistory.duration}</span>
                          : selectedHistory.status === 'EmAndamento' ? 'Em execução...' : '-'
                      } />
                    </div>

                    {/* Azure DevOps */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">☁️ Azure DevOps</h4>
                      <DetailRow label="Disparado" value={
                        <span className={selectedHistory.triggeredAzure ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}>
                          {selectedHistory.triggeredAzure ? 'Sim' : 'Não'}
                        </span>
                      } />
                      {selectedHistory.azureReleaseId && (
                        <DetailRow label="Release ID" value={<span className="font-mono text-emerald-600 dark:text-emerald-400">#{selectedHistory.azureReleaseId}</span>} />
                      )}
                      {selectedHistory.triggeredAzure && (
                        <DetailRow label="Status" value={
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${azureStatusBadgeClass(selectedHistory.azureStatus)}`}>
                            {selectedHistory.azureStatus || 'Disparado'}
                          </span>
                        } />
                      )}
                    </div>

                    {/* Files */}
                    <div className="md:col-span-2 lg:col-span-2">
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">💾 Arquivos</h4>
                      <DetailRow label="Arquivo Backup" value={selectedHistory.backupFile || '-'} mono />
                      <DetailRow label="Caminho Restauração" value={selectedHistory.restorePath || '-'} mono />
                    </div>
                  </div>

                  {/* Post-Restore Check */}
                  {selectedHistory.postCheck && (
                    <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">🔎 Validação Pós-Restauração</h4>
                      <p className="text-xs font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all leading-relaxed">
                        {selectedHistory.postCheck}
                      </p>
                    </div>
                  )}

                  {/* Error */}
                  {selectedHistory.errorMessage && (
                    <div>
                      <h4 className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2">❌ Erro</h4>
                      <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 whitespace-pre-wrap break-all leading-relaxed">
                        {selectedHistory.errorMessage}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <span className="text-4xl block mb-2">👈</span>
                  <p className="text-sm">Clique em um registro para ver os detalhes</p>
                </div>
              )
            ) : (
              selectedDeleteHistory ? (
                <div className="space-y-4">
                  {/* Status Header */}
                  <div className="flex items-center gap-3 pb-3 border-b border-gray-200 dark:border-gray-700">
                    <span className="text-2xl">{statusIcons[selectedDeleteHistory.status] || '🗑️'}</span>
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-white">{selectedDeleteHistory.databaseName}</div>
                      <StatusBadge status={selectedDeleteHistory.status} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {/* User Info */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">👤 Usuário</h4>
                      <DetailRow label="Exclusão feita por" value={selectedDeleteHistory.userName || '-'} />
                    </div>

                    {/* Server Info */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">🖥️ Servidor</h4>
                      <DetailRow label="Servidor" value={selectedDeleteHistory.serverName} />
                      <DetailRow label="Instância" value={selectedDeleteHistory.instanceName} />
                    </div>

                    {/* Timing */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">⏱️ Data/Hora</h4>
                      <DetailRow label="Data da exclusão" value={selectedDeleteHistory.deletedAt ? new Date(selectedDeleteHistory.deletedAt).toLocaleString('pt-BR') : '-'} />
                    </div>

                    {/* Status details */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">ℹ️ Resultado</h4>
                      <DetailRow label="Status" value={<StatusBadge status={selectedDeleteHistory.status} />} />
                      {selectedDeleteHistory.message && (
                        <DetailRow label="Mensagem" value={selectedDeleteHistory.message} />
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <span className="text-4xl block mb-2">👈</span>
                  <p className="text-sm">Clique em um registro para ver os detalhes</p>
                </div>
              )
            )}
          </Card>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Limpar Histórico"
        message={
          historyType === 'restore'
            ? 'Tem certeza que deseja limpar todo o histórico de restaurações? Esta ação não pode ser desfeita.'
            : 'Tem certeza que deseja limpar todo o histórico de exclusões? Esta ação não pode ser desfeita.'
        }
        confirmLabel="Limpar"
        onConfirm={handleClear}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="mb-1.5">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
      <div className={`mt-0.5 text-sm text-gray-700 dark:text-gray-300 ${mono ? 'font-mono text-xs break-all' : ''}`}>
        {value}
      </div>
    </div>
  )
}
