import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serversApi, serverSizeApi } from '../services/api'
import Card from '../components/Card'
import type { Server, DiskInfo, ShareInfo } from '../types'

export default function ServerSizePage() {
  const [selectedServer, setSelectedServer] = useState<Server | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showCredentials, setShowCredentials] = useState(false)

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: serversApi.list,
  })

  const { data: disks = [], isLoading: isLoadingDisks } = useQuery({
    queryKey: ['serverDisks', selectedServer?.name, username, password],
    queryFn: () => serverSizeApi.getDisks({
      serverName: selectedServer!.name,
      username: username || undefined,
      password: password || undefined,
    }),
    enabled: !!selectedServer,
  })

  const { data: shares = [], isLoading: isLoadingShares } = useQuery({
    queryKey: ['serverShares', selectedServer?.name, username, password],
    queryFn: () => serverSizeApi.getShares({
      serverName: selectedServer!.name,
      username: username || undefined,
      password: password || undefined,
    }),
    enabled: !!selectedServer,
  })

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024)
    return `${gb.toFixed(2)} GB`
  }

  const getStatusColor = (usedPercent: number) => {
    if (usedPercent >= 90) return 'text-red-500'
    if (usedPercent >= 70) return 'text-amber-500'
    return 'text-green-500'
  }

  const getProgressColor = (usedPercent: number) => {
    if (usedPercent >= 90) return 'bg-red-500'
    if (usedPercent >= 70) return 'bg-amber-500'
    return 'bg-green-500'
  }

  return (
    <div className="space-y-6">
      {/* Server Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Servidor" icon="🖥" description="Selecione o servidor para consultar">
          <select
            value={selectedServer?.id || ''}
            onChange={(e) => {
              const server = servers.find(s => s.id === Number(e.target.value))
              setSelectedServer(server || null)
            }}
            className="input"
          >
            <option value="">Selecione o servidor</option>
            {servers.map(server => (
              <option key={server.id} value={server.id}>{server.name}</option>
            ))}
          </select>
        </Card>

        <Card title="Credenciais" icon="🔐" description="Credenciais de acesso remoto">
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showCredentials}
                onChange={(e) => setShowCredentials(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Usar credenciais personalizadas</span>
            </label>
            {showCredentials && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Usuário (opcional)"
                  className="input"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Senha (opcional)"
                  className="input"
                />
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Disk Info */}
      {selectedServer && (
        <Card title="Discos" icon="💿" description="Espaço em disco do servidor">
          {isLoadingDisks ? (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : disks.length === 0 ? (
            <div className="text-center p-8 text-gray-500 dark:text-gray-400">
              Nenhum disco encontrado
            </div>
          ) : (
            <div className="space-y-4">
              {disks.map((disk) => (
                <div key={disk.name} className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">💿</span>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {disk.name} {disk.volumeName && `- ${disk.volumeName}`}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {disk.driveType} • {disk.fileSystem}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-lg font-bold ${getStatusColor(disk.usedPercent)}`}>
                        {disk.usedPercent.toFixed(1)}%
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {formatSize(disk.freeSpaceBytes)} livre
                      </div>
                    </div>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${getProgressColor(disk.usedPercent)}`}
                      style={{ width: `${Math.min(disk.usedPercent, 100)}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between mt-2 text-sm text-gray-500 dark:text-gray-400">
                    <span>Total: {formatSize(disk.totalSizeBytes)}</span>
                    <span>Usado: {formatSize(disk.usedSpaceBytes)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Share Info */}
      {selectedServer && (
        <Card title="Compartilhamentos" icon="📁" description="Pastas compartilhadas do servidor">
          {isLoadingShares ? (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : shares.length === 0 ? (
            <div className="text-center p-8 text-gray-500 dark:text-gray-400">
              Nenhum compartilhamento encontrado
            </div>
          ) : (
            <div className="space-y-2">
              {shares.map((share) => (
                <div key={share.name} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">📁</span>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">
                        {share.name}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {share.path}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}