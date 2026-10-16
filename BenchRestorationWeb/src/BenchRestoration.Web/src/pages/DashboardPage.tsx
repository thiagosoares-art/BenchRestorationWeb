import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serversApi, instancesApi, dashboardApi, serverSizeApi } from '../services/api'
import Card from '../components/Card'
import type { Server, Instance, DashboardResponse, DiskInfo, DayMetric, DbDurationMetric } from '../types'

export default function DashboardPage() {
  const [selectedServer, setSelectedServer] = useState<Server | null>(null)
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const updateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: serversApi.list,
  })

  const { data: instances = [] } = useQuery({
    queryKey: ['instances', selectedServer?.id],
    queryFn: () => instancesApi.listByServer(selectedServer!.id),
    enabled: !!selectedServer,
  })

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ['dashboard', selectedServer?.name, selectedInstance?.name],
    queryFn: () =>
      dashboardApi.getMetrics({
        serverName: selectedServer!.name,
        instanceName: selectedInstance!.name,
      }),
    enabled: !!selectedServer && !!selectedInstance,
  })

  // Update the "last updated" timestamp when fresh data arrives
  useEffect(() => {
    if (dashboard) {
      setLastUpdated(new Date().toLocaleString('pt-BR'))
    }
  }, [dashboard])

  // Refresh the displayed timestamp every 30s so it stays current
  useEffect(() => {
    updateTimerRef.current = setInterval(() => {
      setLastUpdated(new Date().toLocaleString('pt-BR'))
    }, 30000)
    return () => {
      if (updateTimerRef.current) clearInterval(updateTimerRef.current)
    }
  }, [])

  const { data: diskInfo = [] } = useQuery({
    queryKey: ['diskInfo', selectedServer?.name],
    queryFn: () => serverSizeApi.getDisks({ serverName: selectedServer!.name }),
    enabled: !!selectedServer,
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Visão geral das restaurações e métricas de desempenho
        </p>
      </div>

      {/* Server/Instance Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Servidor" icon="🖥" description="Selecione o servidor SQL">
          <select
            value={selectedServer?.id || ''}
            onChange={(e) => {
              const server = servers.find((s) => s.id === Number(e.target.value))
              setSelectedServer(server || null)
              setSelectedInstance(null)
            }}
            className="input"
          >
            <option value="">Selecione o servidor</option>
            {servers.map((server) => (
              <option key={server.id} value={server.id}>
                {server.name}
              </option>
            ))}
          </select>
        </Card>

        <Card title="Instância" icon="🗃" description="Selecione a instância">
          <select
            value={selectedInstance?.id || ''}
            onChange={(e) => {
              const instance = instances.find(
                (i) => i.id === Number(e.target.value)
              )
              setSelectedInstance(instance || null)
            }}
            disabled={!selectedServer}
            className="input disabled:opacity-50"
          >
            <option value="">Selecione a instância</option>
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.displayName || instance.name}
              </option>
            ))}
          </select>
        </Card>
      </div>

      {/* Loading State */}
      {isLoading && selectedServer && selectedInstance && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          <span className="ml-3 text-gray-500">Carregando métricas...</span>
        </div>
      )}

      {/* Empty State */}
      {!selectedServer && (
        <div className="text-center py-12">
          <span className="text-5xl mb-4 block">📊</span>
          <p className="text-gray-500 dark:text-gray-400">
            Selecione um servidor e instância para visualizar o dashboard
          </p>
        </div>
      )}

      {dashboard && (
        <>
          {/* Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="Total de Restaurações"
              value={dashboard.metrics.totalRestores}
              icon="📋"
              color="primary"
            />
            <MetricCard
              title="Sucesso"
              value={dashboard.metrics.successCount}
              icon="✅"
              color="success"
            />
            <MetricCard
              title="Erros"
              value={dashboard.metrics.errorCount}
              icon="❌"
              color="error"
            />
            <MetricCard
              title="Taxa de Sucesso"
              value={dashboard.metrics.successRate || 'N/A'}
              icon="📈"
              color="primary"
            />
          </div>

          {/* Secondary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card title="Duração Média" icon="⏱" description="Tempo médio de restauração">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {dashboard.metrics.averageDuration || '-'}
              </p>
            </Card>
            <Card title="Última Atualização" icon="🔄" description="Momento em que os dados foram carregados">
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {lastUpdated || '-'}
              </p>
            </Card>
          </div>

          {/* Success/Error Chart (last 14 days) */}
          {dashboard.dailyActivity && dashboard.dailyActivity.length > 0 && (
            <Card title="Sucesso x Erros (14 dias)" icon="📊" description="Restaurações bem-sucedidas vs falhas por dia">
              <SuccessErrorChart data={dashboard.dailyActivity} />
            </Card>
          )}

          {/* Duration by Database */}
          {dashboard.durationByDatabase && dashboard.durationByDatabase.length > 0 && (
            <Card title="Duração Média por Banco" icon="⏱" description="Tempo médio de restauração por banco (top 8)">
              <DurationChart data={dashboard.durationByDatabase} />
            </Card>
          )}

          {/* Backup Status */}
          {dashboard.backupStatus.length > 0 && (
            <Card title="Status dos Backups" icon="💾" description="Estado atual dos backups">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {dashboard.backupStatus.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {item.status}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Timeline */}
          {dashboard.timeline.length > 0 && (
            <Card title="Timeline" icon="📅" description="Restaurações recentes">
              <div className="space-y-3">
                {dashboard.timeline.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-4 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex-shrink-0 w-16 text-right">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {item.time}
                      </span>
                    </div>
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.statusColor }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {item.databaseName}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                        {item.duration}
                      </span>
                    </div>
                    <span
                      className="px-2 py-1 text-xs font-semibold rounded flex-shrink-0"
                      style={{
                        backgroundColor: `${item.statusColor}20`,
                        color: item.statusColor,
                      }}
                    >
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Disk Usage */}
          {diskInfo.length > 0 && (
            <Card title="Uso de Disco" icon="💿" description="Espaço em disco do servidor">
              <div className="space-y-4">
                {diskInfo.map((disk: DiskInfo, index: number) => (
                  <div key={index} className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">💾</span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {disk.name} ({disk.volumeName || 'Local'})
                        </span>
                      </div>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {disk.fileSystem}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 mb-2">
                      <div
                        className={`h-3 rounded-full transition-all duration-300 ${
                          disk.usedPercent > 90 ? 'bg-red-500' :
                          disk.usedPercent > 70 ? 'bg-amber-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(disk.usedPercent, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>Usado: {disk.usedSpaceGB.toFixed(1)} GB</span>
                      <span>Livre: {disk.freeSpaceGB.toFixed(1)} GB</span>
                      <span>Total: {disk.totalSizeGB.toFixed(1)} GB ({disk.usedPercent.toFixed(1)}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function MetricCard({
  title,
  value,
  icon,
  color,
}: {
  title: string
  value: number | string
  icon: string
  color: 'primary' | 'success' | 'error'
}) {
  const colorClasses = {
    primary: 'from-primary-50 to-primary-100 dark:from-primary-900/50 dark:to-primary-800/50 text-primary-600 dark:text-primary-400',
    success: 'from-green-50 to-green-100 dark:from-green-900/50 dark:to-green-800/50 text-green-600 dark:text-green-400',
    error: 'from-red-50 to-red-100 dark:from-red-900/50 dark:to-red-800/50 text-red-600 dark:text-red-400',
  }

  return (
    <div className="bg-white dark:bg-gray-800/50 rounded-xl shadow-sm border border-gray-200/50 dark:border-gray-700/50 backdrop-blur-sm p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
          <p className={`text-3xl font-bold mt-1 ${colorClasses[color].split(' ').pop()}`}>
            {value}
          </p>
        </div>
        <div className={`w-12 h-12 bg-gradient-to-br ${colorClasses[color].split(' ').slice(0, -1).join(' ')} rounded-xl flex items-center justify-center`}>
          <span className="text-xl">{icon}</span>
        </div>
      </div>
    </div>
  )
}

function SuccessErrorChart({ data }: { data: DayMetric[] }) {
  const maxTotal = Math.max(
    1,
    ...data.map((d) => d.successCount + d.errorCount)
  )

  return (
    <div>
      <div className="flex items-end gap-1 h-40">
        {data.map((d, index) => {
          const total = d.successCount + d.errorCount
          const totalPct = (total / maxTotal) * 100
          const errorPct = total > 0 ? (d.errorCount / total) * 100 : 0
          return (
            <div
              key={index}
              className="flex-1 flex flex-col items-center justify-end h-full min-w-0"
              title={`${d.date} — ${d.successCount} sucesso, ${d.errorCount} erros`}
            >
              {total > 0 ? (
                <div
                  className="w-full max-w-[36px] rounded-t overflow-hidden flex flex-col justify-end"
                  style={{ height: `${totalPct}%` }}
                >
                  <div className="w-full flex-1 bg-green-500 dark:bg-green-600"></div>
                  <div
                    className="w-full bg-red-500 dark:bg-red-600"
                    style={{ height: `${errorPct}%` }}
                  ></div>
                </div>
              ) : (
                <div className="w-full flex-1 rounded-t bg-gray-100 dark:bg-gray-700"></div>
              )}
              <span className="text-[10px] text-gray-500 dark:text-gray-400 mt-1 truncate w-full text-center">
                {d.date.slice(8)}
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-green-500 dark:bg-green-600 inline-block"></span>
          Sucesso
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-red-500 dark:bg-red-600 inline-block"></span>
          Erros
        </span>
      </div>
    </div>
  )
}

function DurationChart({ data }: { data: DbDurationMetric[] }) {
  const maxValue = Math.max(
    1,
    ...data.map((d) => {
      const m = d.averageDuration.match(/([\d.,]+)\s*(s|min)/)
      if (!m) return 0
      const val = parseFloat(m[1].replace(',', '.'))
      return m[2] === 'min' ? val * 60 : val
    })
  )

  return (
    <div className="space-y-2">
      {data.map((item, index) => {
        const m = item.averageDuration.match(/([\d.,]+)\s*(s|min)/)
        const sec = m ? (m[2] === 'min' ? parseFloat(m[1].replace(',', '.')) * 60 : parseFloat(m[1].replace(',', '.'))) : 0
        const pct = (sec / maxValue) * 100
        return (
          <div key={index} className="flex items-center gap-3">
            <span className="text-sm text-gray-700 dark:text-gray-300 w-40 truncate text-right" title={item.databaseName}>
              {item.databaseName}
            </span>
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4">
              <div
                className="h-4 rounded-full transition-all duration-500 bg-gradient-to-r from-primary-400 to-primary-600"
                style={{ width: `${Math.max(pct, item.averageDuration ? 3 : 0)}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono w-16">
              {item.averageDuration}
            </span>
          </div>
        )
      })}
    </div>
  )
}
