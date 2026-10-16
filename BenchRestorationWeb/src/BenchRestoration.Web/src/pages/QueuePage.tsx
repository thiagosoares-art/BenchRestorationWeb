import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { serversApi, instancesApi, queueApi } from '../services/api'
import Card from '../components/Card'
import type { Server, Instance, QueueItem } from '../types'

export default function QueuePage() {
  const queryClient = useQueryClient()
  const [selectedServer, setSelectedServer] = useState<Server | null>(null)
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: serversApi.list,
  })

  const { data: instances = [] } = useQuery({
    queryKey: ['instances', selectedServer?.id],
    queryFn: () => instancesApi.listByServer(selectedServer!.id),
    enabled: !!selectedServer,
  })

  const { data: queueItems = [], isLoading } = useQuery({
    queryKey: ['queueItems', selectedServer?.name, selectedInstance?.name],
    queryFn: () => queueApi.getItems({
      serverName: selectedServer!.name,
      instanceName: selectedInstance!.name,
    }),
    enabled: !!selectedServer && !!selectedInstance,
    refetchInterval: 5000,
  })

  const removeMutation = useMutation({
    mutationFn: (jobId: number) => queueApi.removeItem({
      serverName: selectedServer!.name,
      instanceName: selectedInstance!.name,
      jobId,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queueItems'] })
    },
  })

  const resetStuckMutation = useMutation({
    mutationFn: () => queueApi.resetStuck({
      serverName: selectedServer!.name,
      instanceName: selectedInstance!.name,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queueItems'] })
    },
  })

  const getStatusBadge = (status: QueueItem['status']) => {
    switch (status) {
      case 'Running':
        return (
          <span className="px-2 py-1 text-xs font-bold rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400">
            Em execução
          </span>
        )
      case 'Pending':
        return (
          <span className="px-2 py-1 text-xs font-bold rounded bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400">
            Pendente
          </span>
        )
      case 'Completed':
        return (
          <span className="px-2 py-1 text-xs font-bold rounded bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400">
            Concluído
          </span>
        )
      case 'Failed':
        return (
          <span className="px-2 py-1 text-xs font-bold rounded bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-400">
            Falhou
          </span>
        )
      default:
        return null
    }
  }

  const pendingCount = queueItems.filter(i => i.status === 'Pending').length
  const runningCount = queueItems.filter(i => i.status === 'Running').length
  const completedCount = queueItems.filter(i => i.status === 'Completed').length
  const failedCount = queueItems.filter(i => i.status === 'Failed').length

  return (
    <div className="space-y-6">
      {/* Server/Instance Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Servidor" icon="🖥" description="Selecione o servidor">
          <select
            value={selectedServer?.id || ''}
            onChange={(e) => {
              const server = servers.find(s => s.id === Number(e.target.value))
              setSelectedServer(server || null)
              setSelectedInstance(null)
            }}
            className="input"
          >
            <option value="">Selecione o servidor</option>
            {servers.map(server => (
              <option key={server.id} value={server.id}>{server.name}</option>
            ))}
          </select>
        </Card>

        <Card title="Instância" icon="🗃" description="Selecione a instância">
          <select
            value={selectedInstance?.id || ''}
            onChange={(e) => {
              const instance = instances.find(i => i.id === Number(e.target.value))
              setSelectedInstance(instance || null)
            }}
            disabled={!selectedServer}
            className="input disabled:opacity-50"
          >
            <option value="">Selecione a instância</option>
            {instances.map(instance => (
              <option key={instance.id} value={instance.id}>{instance.displayName || instance.name}</option>
            ))}
          </select>
        </Card>
      </div>

      {/* Queue Stats */}
      {selectedServer && selectedInstance && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-4">
            <div className="text-2xl font-bold text-amber-500">{pendingCount}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Pendentes</div>
          </div>
          <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-4">
            <div className="text-2xl font-bold text-blue-500">{runningCount}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Em execução</div>
          </div>
          <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-4">
            <div className="text-2xl font-bold text-green-500">{completedCount}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Concluídos</div>
          </div>
          <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200/50 dark:border-gray-700/50 p-4">
            <div className="text-2xl font-bold text-red-500">{failedCount}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">Falharam</div>
          </div>
        </div>
      )}

      {/* Queue List */}
      {selectedServer && selectedInstance && (
        <Card title="Fila de Restauração" icon="📋" description="Itens na fila de restauração">
          <div className="flex justify-end mb-4">
            <button
              onClick={() => resetStuckMutation.mutate()}
              disabled={resetStuckMutation.isPending}
              className="btn-secondary text-sm disabled:opacity-50"
            >
              {resetStuckMutation.isPending ? 'Reiniciando...' : 'Reiniciar jobs travados'}
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : queueItems.length === 0 ? (
            <div className="text-center p-8 text-gray-500 dark:text-gray-400">
              <span className="text-4xl mb-2 block">📋</span>
              Nenhum item na fila
            </div>
          ) : (
            <div className="space-y-3">
              {queueItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="text-lg font-bold text-gray-400 dark:text-gray-500">
                        #{item.sortOrder}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {item.databaseName}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Solicitado por: {item.requestedBy}
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          {new Date(item.createdAt).toLocaleString('pt-BR')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(item.status)}
                      {item.status === 'Pending' && (
                        <button
                          onClick={() => removeMutation.mutate(item.id)}
                          disabled={removeMutation.isPending}
                          className="text-red-500 hover:text-red-700 text-sm disabled:opacity-50"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  </div>
                  {item.errorMessage && (
                    <div className="mt-2 text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-2 rounded">
                      {item.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}