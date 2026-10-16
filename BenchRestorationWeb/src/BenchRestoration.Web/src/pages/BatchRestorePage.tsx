import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { serversApi, instancesApi, restoreApi, settingsApi, databasesApi, securityRulesApi } from '../services/api'
import { useSignalR } from '../hooks/useSignalR'
import { useBatchState, BatchItem } from '../contexts/BatchContext'
import Card from '../components/Card'
import Terminal from '../components/Terminal'
import type { Server, Instance, BackupSearchResult, BackupSearchResponse } from '../types'

export default function BatchRestorePage() {
  const { lastStatus, copyProgress, restoreProgress, azureStatus, lastRestoreComplete } = useSignalR()
  const {
    isProcessing, setIsProcessing,
    batchItems, setBatchItems,
    currentBatchId, setCurrentBatchId,
    terminalEntries, appendTerminal, updateTerminal, clearTerminal,
    cancelBatch, batchAbortRef, isProcessingRef
  } = useBatchState()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [selectedServer, setSelectedServer] = useState<Server | null>(null)
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)
  const [searchFilter, setSearchFilter] = useState('')

  // Options
  const [verifyIntegrity, setVerifyIntegrity] = useState(true)
  const [includeLogDb, setIncludeLogDb] = useState(true)
  const [cleanupAfter, setCleanupAfter] = useState(true)
  const [triggerAzure, setTriggerAzure] = useState(true)
  const [sendNotification, setSendNotification] = useState(true)
  const [runPostScripts, setRunPostScripts] = useState(true)

  // Fetch servers
  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: serversApi.list,
  })

  // Fetch instances
  const { data: instances = [] } = useQuery({
    queryKey: ['instances', selectedServer?.id],
    queryFn: () => instancesApi.listByServer(selectedServer!.id),
    enabled: !!selectedServer,
  })

  // Fetch settings
  const { data: currentSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  // Fetch known databases
  const { data: knownDatabases = [] } = useQuery({
    queryKey: ['knownDatabases'],
    queryFn: databasesApi.listKnown,
  })

  // Add databases from textarea
  const handleAddDatabases = () => {
    const text = textareaRef.current?.value || ''
    const names = text.split('\n').map(n => n.trim()).filter(n => n.length > 0)

    if (names.length === 0) {
      toast.error('Digite pelo menos um nome de banco')
      return
    }

    const newItems: BatchItem[] = names.map((name, idx) => ({
      id: Date.now() + idx,
      databaseName: name,
      status: 'Pendente' as const,
      message: 'Aguardando processamento',
    }))

    setBatchItems(prev => [...prev, ...newItems])
    textareaRef.current!.value = ''
    toast.success(`${names.length} banco(s) adicionado(s) à fila`)
  }

  // Remove item from batch
  const handleRemoveItem = (id: number) => {
    setBatchItems(prev => prev.filter(item => item.id !== id))
  }

  // Clear all pending items
  const handleClearPending = () => {
    setBatchItems(prev => prev.filter(item => item.status === 'Restaurando'))
  }

  // Start batch processing
  const handleStartBatch = async () => {
    if (!selectedServer || !selectedInstance) {
      toast.error('Selecione servidor e instância')
      return
    }

    const pendingItems = batchItems.filter(item => item.status === 'Pendente')
    if (pendingItems.length === 0) {
      toast.error('Nenhum banco pendente para processar')
      return
    }

    const abortController = new AbortController()
    batchAbortRef.current = abortController
    setIsProcessing(true)
    isProcessingRef.current = true
    clearTerminal()
    appendTerminal(`Iniciando lote: ${pendingItems.length} banco(s)`, '#FFC107')

    // Working copy to avoid stale closure issues
    let items = [...batchItems]

    // Collect history IDs of successfully restored databases for the Azure trigger
    const restoredHistoryIds: number[] = []

    for (const item of pendingItems) {
      if (!isProcessingRef.current) break

      // Check security rules for restoration
      const ruleCheck = await securityRulesApi.check({
        serverName: selectedServer.name,
        instanceName: selectedInstance.name,
        databaseName: item.databaseName,
        operation: 'Restauração'
      })
      if (ruleCheck.hasRule) {
        items = items.map(i =>
          i.id === item.id ? { ...i, status: 'Erro', message: `Protegido por regra de segurança (${ruleCheck.ruleType})`, endTime: new Date().toISOString() } : i
        )
        setBatchItems(items)
        appendTerminal(`  ❌ ${item.databaseName}: Protegido por regra de segurança (${ruleCheck.ruleType})`, '#F44336')
        continue
      }

      setCurrentBatchId(item.id)
      items = items.map(i =>
        i.id === item.id ? { ...i, status: 'Restaurando', message: 'Iniciando...', startTime: new Date().toISOString() } : i
      )
      setBatchItems(items)

      appendTerminal(`\n━━━ Processando: ${item.databaseName} ━━━`, '#FFEB3B')

      try {
        // Search for backup
        appendTerminal(`  Buscando backups para '${item.databaseName}'...`, '#00BCD4')
        const backupsResult = await restoreApi.searchBackups(item.databaseName, includeLogDb)
        const dbBackups = backupsResult.backups
        if (dbBackups.length === 0) {
          throw new Exception(`Nenhum backup encontrado para ${item.databaseName}`)
        }

        // Select the most recent FULL base + most recent DIFF chain.
        // The backend tries DIFFs from most recent to oldest, skipping any broken one.
        const sortDesc = (arr: BackupSearchResult[]) =>
          [...arr].sort((a, b) => new Date(b.lastBackupDate).getTime() - new Date(a.lastBackupDate).getTime())

        const fullBackups = sortDesc(dbBackups.filter(b => b.backupType === 'FULL'))
        const diffBackups = sortDesc(dbBackups.filter(b => b.backupType === 'DIFF'))

        let backupFilePaths: string[] | undefined
        let selectedBackup: BackupSearchResult

        if (diffBackups.length > 0) {
          backupFilePaths = diffBackups.map(b => b.filePath)
          selectedBackup = diffBackups[0]
          appendTerminal(`  DIFF encadeado: ${selectedBackup.name}${fullBackups.length > 0 ? ` (FULL base: ${fullBackups[0].name})` : ''}`, '#4CAF50')
        } else {
          selectedBackup = fullBackups.length > 0
            ? fullBackups[0]
            : sortDesc(dbBackups)[0]
          appendTerminal(`  Backup selecionado: ${selectedBackup.name} (${selectedBackup.lastBackupDate ? new Date(selectedBackup.lastBackupDate).toLocaleDateString('pt-BR') : 'N/A'})`, '#4CAF50')
        }

        // Select LOG backup if included
        let selectedLogBackup: string | undefined
        if (includeLogDb && backupsResult.logBackups.length > 0) {
          const logFull = backupsResult.logBackups.filter(b => b.backupType === 'FULL')
          selectedLogBackup = (logFull.length > 0 ? logFull : backupsResult.logBackups)
            .sort((a, b) => new Date(b.lastBackupDate).getTime() - new Date(a.lastBackupDate).getTime())[0].filePath
          appendTerminal(`  Backup LOG: ${selectedLogBackup.split('\\').pop() || selectedLogBackup}`, '#00BCD4')
        }

        setBatchItems(prev => prev.map(i =>
          i.id === item.id ? { ...i, message: `Backup: ${selectedBackup.name}`, backupFile: selectedBackup.filePath } : i
        ))

        // Execute restore
        const restorePath = selectedServer.restorePath
          ? `${selectedServer.restorePath}\\${selectedInstance.name}\\${item.databaseName}`
          : `D:\\Bases\\${selectedInstance.name}\\${item.databaseName}`

        appendTerminal(`  Restaurando ${item.databaseName}...`, '#FFC107')
        const result = await restoreApi.start({
          serverName: selectedServer.name,
          instanceName: selectedInstance.name,
          databaseName: item.databaseName,
          backupFilePath: selectedBackup.filePath,
          backupFilePaths,
          restorePath,
          sqlUsername: currentSettings?.sqlUsername || undefined,
          sqlPassword: currentSettings?.sqlPassword || undefined,
          verifyIntegrity,
          cleanupAfterRestore: cleanupAfter,
          triggerAzure: false,
          sendNotification: false,
          reuseBackup: false,
          includeLogDb,
          logBackupFilePath: selectedLogBackup,
        }, abortController.signal) as { success: boolean; message: string; duration?: string; historyId?: number }

        if (result.success) {
          items = items.map(i =>
            i.id === item.id ? {
              ...i,
              status: 'Concluido',
              message: `Sucesso - ${result.duration || ''}`,
              endTime: new Date().toISOString()
            } : i
          )
          setBatchItems(items)
          if (result.historyId) restoredHistoryIds.push(result.historyId)
          appendTerminal(`  ✅ ${item.databaseName} restaurado com sucesso (${result.duration || ''})`, '#4CAF50')
        } else {
          throw new Error(result.message)
        }

        // Save to known databases
        databasesApi.addKnown(item.databaseName).catch(() => {})

      } catch (error: any) {
        const isCancelled = error.name === 'AbortError'
        const errMsg = isCancelled ? 'Cancelado pelo usuário' : (error.message || error.toString?.() || 'Erro desconhecido')
        items = items.map(i =>
          i.id === item.id ? {
            ...i,
            status: 'Erro',
            message: errMsg,
            endTime: new Date().toISOString()
          } : i
        )
        setBatchItems(items)
        const color = isCancelled ? '#FF9800' : '#F44336'
        appendTerminal(`  ${isCancelled ? '⚠️' : '❌'} ${item.databaseName}: ${errMsg}`, color)
        if (isCancelled) break
      }
    }

    // Calculate final counts from local working array
    const successCount = items.filter(i => i.status === 'Concluido').length
    let errorCount = items.filter(i => i.status === 'Erro').length

    // Post-batch: Azure trigger (once for all)
    if (triggerAzure) {
      appendTerminal('\nDisparando pipeline Azure DevOps...', '#00BCD4')
      try {
        const successDbs = items.filter(i => i.status === 'Concluido').map(i => i.databaseName)
        if (successDbs.length > 0 && restoredHistoryIds.length > 0) {
          const result = await restoreApi.batchAzureTrigger({
            instanceName: selectedInstance.name,
            databaseNames: successDbs,
            historyIds: restoredHistoryIds,
          })
          if (result.success) {
            appendTerminal(result.message, '#4CAF50')
            if (result.releaseId) {
              appendTerminal(`  Release #${result.releaseId} - acompanhando status...`, '#00BCD4')
            }
          } else {
            appendTerminal(result.message, '#F44336')
          }
        } else {
          appendTerminal('Nenhum banco restaurado com sucesso para disparar a pipeline', '#FF9800')
        }
      } catch (e: any) {
        appendTerminal(`Aviso: Erro Azure DevOps: ${e.message}`, '#FF9800')
      }
    }

    // Post-batch: Notification
    if (sendNotification && currentSettings?.notificationApiUrl) {
      appendTerminal('\nEnviando notificação do lote...', '#00BCD4')
      try {
        const notifBody = {
          bancoDados: successCount > 0 ? items.filter(i => i.status === 'Concluido').map(i => i.databaseName).join(', ') : 'Nenhum',
          ambiente: `${selectedServer?.name}\\${selectedInstance?.name}`,
          resultado: `${successCount} sucesso, ${errorCount} erro(s)`,
          data: new Date().toISOString()
        }

        const response = await fetch(currentSettings!.notificationApiUrl!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notifBody)
        })

        if (response.ok) {
          appendTerminal(`Notificação enviada com sucesso: ${successCount} sucesso, ${errorCount} erro(s)`, '#4CAF50')
        } else {
          appendTerminal(`Aviso: Falha ao enviar notificação (HTTP ${response.status})`, '#FF9800')
        }
      } catch (e: any) {
        appendTerminal(`Aviso: Erro notificação: ${e.message}`, '#FF9800')
      }
    }

    setIsProcessing(false)
    isProcessingRef.current = false
    setCurrentBatchId(0)
    batchAbortRef.current = null

    // Summary
    appendTerminal(`\n━━━ Lote finalizado: ${successCount} sucesso, ${errorCount} erro(s) ━━━`, '#4CAF50')
    toast.success(`Lote finalizado: ${successCount} sucesso, ${errorCount} erro(s)!`)
  }

  // Stop batch
  const handleStopBatch = () => {
    cancelBatch()
    appendTerminal('[AVISO] Lote interrompido pelo usuário', '#FF9800')
    toast.error('Lote interrompido')
  }

  // Update terminal from SignalR
  useEffect(() => {
    if (lastStatus && isProcessing && currentBatchId) {
      appendTerminal(lastStatus.message, lastStatus.color)
    }
  }, [lastStatus, isProcessing, currentBatchId, appendTerminal])

  // Show Azure environment status updates in the terminal (updated in the same line)
  useEffect(() => {
    if (azureStatus && azureStatus.historyIds?.length > 0) {
      const marker = `[Azure #${azureStatus.releaseId}]`
      updateTerminal(marker, `  ${marker} ${azureStatus.status}`, azureStatus.color)
    }
  }, [azureStatus, updateTerminal])

  // Derive restore progress from status messages as a fallback
  const [statusRestorePercent, setStatusRestorePercent] = useState<number | null>(null)
  useEffect(() => {
    if (!lastStatus || !isProcessing) return
    const m = lastStatus.message.match(/(\d{1,3})\s*(?:por cento|percent)/i)
    if (m && parseInt(m[1]) < 100) {
      setStatusRestorePercent(parseInt(m[1]))
    } else if (lastStatus.message.includes('processou') || lastStatus.message.includes('remov')) {
      setStatusRestorePercent(null)
    }
  }, [lastStatus, isProcessing])

  // Finalize the restore progress bar at 100% only AFTER the Azure DevOps pipeline
  // reaches a terminal status (when Azure was requested). Otherwise finalize on restore complete.
  const [restoreCompleted, setRestoreCompleted] = useState(false)
  const [azureRequested, setAzureRequested] = useState(false)
  const [finalAzureStatus, setFinalAzureStatus] = useState<string | null>(null)
  const [restoreFinished, setRestoreFinished] = useState(false)

  useEffect(() => {
    setRestoreCompleted(false)
    setAzureRequested(triggerAzure)
    setFinalAzureStatus(null)
    setRestoreFinished(false)
  }, [currentBatchId])

  useEffect(() => {
    if (lastRestoreComplete?.success) {
      setRestoreCompleted(true)
    }
  }, [lastRestoreComplete])

  useEffect(() => {
    if (!azureStatus || !azureStatus.historyIds?.length) return
    const terminal = ['succeeded', 'partiallysucceeded', 'rejected', 'canceled'].includes(azureStatus.rawStatus)
    if (terminal) {
      setFinalAzureStatus(azureStatus.status)
      setRestoreFinished(true)
      setRestoreCompleted(true)
    }
  }, [azureStatus])

  useEffect(() => {
    if (restoreCompleted && !azureRequested) {
      setRestoreFinished(true)
    }
  }, [restoreCompleted, azureRequested])

  const azurePending = restoreCompleted && azureRequested && !restoreFinished

  useEffect(() => {
    if (!azurePending) return
    const timer = setTimeout(() => {
      setFinalAzureStatus(current => current || 'Pendente')
      setRestoreFinished(true)
    }, 15 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [azurePending])

  // Stats
  const stats = {
    total: batchItems.length,
    pending: batchItems.filter(i => i.status === 'Pendente').length,
    processing: batchItems.filter(i => i.status === 'Restaurando').length,
    success: batchItems.filter(i => i.status === 'Concluido').length,
    errors: batchItems.filter(i => i.status === 'Erro').length,
  }

  const filteredItems = searchFilter
    ? batchItems.filter(i => i.databaseName.toLowerCase().includes(searchFilter.toLowerCase()))
    : batchItems

  const statusColors: Record<string, string> = {
    Pendente: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
    Restaurando: 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400',
    Concluido: 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400',
    Erro: 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Restauração em Lote</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Restaure múltiplos bancos de dados de uma vez
          </p>
        </div>
      </div>

      {/* Server/Instance Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Servidor" icon="🖥" description="Selecione o servidor SQL">
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

      {/* Database Input + Options side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Adicionar Bancos" icon="💾" description="Digite os nomes dos bancos (um por linha)">
          <div className="space-y-4">
            <textarea
              ref={textareaRef}
              rows={4}
              className="input font-mono text-sm"
              placeholder={"Banco1\nBanco2\nBanco3\n..."}
            />
            <div className="flex gap-3">
              <button onClick={handleAddDatabases} className="btn-primary">+ Adicionar à Fila</button>
              {batchItems.length > 0 && (
                <button onClick={handleClearPending} className="btn-secondary">Limpar Pendentes</button>
              )}
            </div>
          </div>
        </Card>

        <Card title="Opções" icon="⚙️" description="Configurações da restauração">
          <div className="space-y-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
              <span className="text-base shrink-0 mt-0.5">ℹ️</span>
              <span>Os bancos restaurados nesta tela usarão sempre o <strong>backup FULL mais recente</strong> disponível para cada banco.</span>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={verifyIntegrity} onChange={(e) => setVerifyIntegrity(e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Verificar integridade</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={includeLogDb} onChange={(e) => setIncludeLogDb(e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Incluir LOG</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cleanupAfter} onChange={(e) => setCleanupAfter(e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Limpar backups</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={runPostScripts} onChange={(e) => setRunPostScripts(e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Scripts pós-restauração</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={triggerAzure} onChange={(e) => setTriggerAzure(e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Azure DevOps (no final)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={sendNotification} onChange={(e) => setSendNotification(e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Notificação (no final)</span>
              </label>
            </div>
          </div>
        </Card>
      </div>

      {/* Stats Bar */}
      {batchItems.length > 0 && (
        <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200/50 dark:border-gray-700/50 px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-6 text-sm">
              <span className="text-gray-600 dark:text-gray-300">Total: <strong>{stats.total}</strong></span>
              <span className="text-gray-500">Pendente: <strong>{stats.pending}</strong></span>
              <span className="text-blue-500">Processando: <strong>{stats.processing}</strong></span>
              <span className="text-green-500">Sucesso: <strong>{stats.success}</strong></span>
              <span className="text-red-500">Erros: <strong>{stats.errors}</strong></span>
            </div>
            <div className="flex items-center gap-3">
              {stats.total > 0 && (
                <div className="w-48 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${((stats.success + stats.errors) / stats.total) * 100}%` }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Copy Progress Bar */}
      {copyProgress && copyProgress.percent > 0 && copyProgress.percent < 100 && (
        <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200/50 dark:border-gray-700/50 px-6 py-3">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
            <span>Copiando backup... {copyProgress.percent}%</span>
            <span>{copyProgress.copiedMb.toFixed(1)}MB / {copyProgress.totalMb.toFixed(1)}MB</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${copyProgress.percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Restore Progress Bar */}
      {restoreFinished ? (
        <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-emerald-300 dark:border-emerald-700/60 px-6 py-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
              ✅ Restauração Finalizada{finalAzureStatus ? ` | Azure DevOps: ${finalAzureStatus}` : ''}
            </span>
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">100%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-300 ease-out" style={{ width: '100%' }} />
          </div>
        </div>
      ) : azurePending ? (
        <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-cyan-300 dark:border-cyan-700/60 px-6 py-3">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-cyan-600 dark:text-cyan-400 font-medium">
              ⏳ Restauração concluída - aguardando pipeline Azure DevOps ({azureStatus?.status || '...'})...
            </span>
            <span className="text-cyan-600 dark:text-cyan-400 font-medium">100%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-cyan-400 to-cyan-500 rounded-full transition-all duration-300 ease-out" style={{ width: '100%' }} />
          </div>
        </div>
      ) : (restoreProgress && restoreProgress.percent > 0 && restoreProgress.percent < 100) ||
        (isProcessing && statusRestorePercent !== null) ? (
        <div className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200/50 dark:border-gray-700/50 px-6 py-3">
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
            <span>Restaurando{restoreProgress?.phase && ` [${restoreProgress.phase}]`}{restoreProgress?.database ? `: ${restoreProgress.database}` : ''}... {restoreProgress ? restoreProgress.percent : statusRestorePercent}%</span>
            <span>{restoreProgress ? restoreProgress.percent : statusRestorePercent}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${restoreProgress ? restoreProgress.percent : statusRestorePercent}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Batch List */}
        <Card title="Fila de Restauração" icon="📋" description={`${filteredItems.length} item(s)`}>
          <div className="space-y-3">
            {/* Search Filter */}
            {batchItems.length > 5 && (
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filtrar por nome..."
                className="input text-sm"
              />
            )}

            <div className="max-h-[400px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
              {filteredItems.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  <span className="text-4xl mb-2 block">📦</span>
                  Nenhum banco na fila
                </div>
              ) : (
                filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 p-3 border-b border-gray-100 dark:border-gray-700/50 last:border-0 ${
                      currentBatchId === item.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {item.databaseName}
                        </span>
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded ${statusColors[item.status]}`}>
                          {item.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                        {item.message}
                      </p>
                    </div>
                    {item.status === 'Pendente' && !isProcessing && (
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>

        {/* Console */}
        <Card title="Console" icon="💻" description="Log do processamento" className="flex flex-col">
          <div className="flex-1 flex flex-col">
            <Terminal entries={terminalEntries} onClear={clearTerminal} />
          </div>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200/50 dark:border-gray-700/50 px-6 py-4">
        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <span className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`}></span>
          <span>{isProcessing ? 'Processando lote...' : `${stats.pending} banco(s) pendente(s)`}</span>
        </div>
        <div className="flex items-center gap-3">
          {isProcessing ? (
            <button onClick={handleStopBatch} className="btn-danger flex items-center gap-2 px-6 py-3">
              ⏹ Parar Lote
            </button>
          ) : (
            <button
              onClick={handleStartBatch}
              disabled={!selectedServer || !selectedInstance || stats.pending === 0}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 px-6 py-3"
            >
              ▶ Iniciar Lote ({stats.pending})
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

class Exception extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Exception'
  }
}
