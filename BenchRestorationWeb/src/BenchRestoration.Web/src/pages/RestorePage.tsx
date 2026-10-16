import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serversApi, instancesApi, restoreApi, settingsApi, databasesApi, securityRulesApi } from '../services/api'
import { useSignalR } from '../hooks/useSignalR'
import { useRestoreState } from '../contexts/RestoreContext'
import Card from '../components/Card'
import Terminal from '../components/Terminal'
import type { Server, Instance, BackupSearchResult, BackupSearchResponse } from '../types'

export default function RestorePage() {
  const { lastStatus, copyProgress, restoreProgress, azureStatus, lastRestoreComplete } = useSignalR()
  const { isRestoring, setIsRestoring, terminalEntries, appendTerminal, updateTerminal, clearTerminal, cancelRestore, restoreAbortRef } = useRestoreState()

  const [selectedServer, setSelectedServer] = useState<Server | null>(null)
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null)
  const [databaseName, setDatabaseName] = useState('')
  const [backups, setBackups] = useState<BackupSearchResult[]>([])
  const [logBackups, setLogBackups] = useState<BackupSearchResult[]>([])
  const [selectedBackups, setSelectedBackups] = useState<Set<string>>(new Set())
  const [selectedLogBackup, setSelectedLogBackup] = useState<string>('')
  const [isSearching, setIsSearching] = useState(false)

  const [verifyIntegrity, setVerifyIntegrity] = useState(true)
  const [includeLogDb, setIncludeLogDb] = useState(false)
  const [useDiffDateRestore, setUseDiffDateRestore] = useState(false)
  const [diffRestoreDate, setDiffRestoreDate] = useState('')
  const [diffRestoreTime, setDiffRestoreTime] = useState('')
  const [cleanupAfter, setCleanupAfter] = useState(true)
  const [triggerAzure, setTriggerAzure] = useState(true)
  const [sendNotification, setSendNotification] = useState(true)
  const [reuseBackup, setReuseBackup] = useState(false)

  // Fetch servers
  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: serversApi.list,
  })

  // Fetch instances when server changes
  const { data: instances = [] } = useQuery({
    queryKey: ['instances', selectedServer?.id],
    queryFn: () => instancesApi.listByServer(selectedServer!.id),
    enabled: !!selectedServer,
  })

  // Fetch settings for SQL credentials
  const { data: currentSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  // Sync includeLogDb with global setting
  useEffect(() => {
    if (currentSettings?.defaultIncludeLogDatabase !== undefined) {
      setIncludeLogDb(currentSettings.defaultIncludeLogDatabase)
    }
  }, [currentSettings?.defaultIncludeLogDatabase])

  // Fetch known databases for autocomplete
  const { data: knownDatabases = [] } = useQuery({
    queryKey: ['knownDatabases'],
    queryFn: databasesApi.listKnown,
  })

  // Search backups
  const handleSearch = async () => {
    if (!databaseName.trim()) {
      appendTerminal('[AVISO] Digite o nome do banco de dados.', '#FF9800')
      return
    }

    setIsSearching(true)
    clearTerminal()
    setSelectedLogBackup('')
    appendTerminal(`[INFO] Buscando backups para '${databaseName}'...`, '#00BCD4')

    try {
      const result: BackupSearchResponse = await restoreApi.searchBackups(databaseName, includeLogDb)
      setBackups(result.backups)
      setLogBackups(result.logBackups)
      appendTerminal(`[INFO] Encontrados ${result.backups.length} arquivo(s) de backup.`, '#00BCD4')
      if (includeLogDb) {
        appendTerminal(`[INFO] Encontrados ${result.logBackups.length} arquivo(s) de backup LOG.`, '#00BCD4')
        // Auto-select first FULL LOG backup
        if (result.logBackups.length > 0) {
          const firstFull = result.logBackups.find(b => b.backupType === 'FULL')
          setSelectedLogBackup(firstFull?.filePath ?? result.logBackups[0].filePath)
        }
      }
    } catch (error) {
      appendTerminal(`[ERRO] Falha ao buscar backups: ${error}`, '#F44336')
    } finally {
      setIsSearching(false)
    }
  }

  // Toggle backup selection
  const toggleBackup = (filePath: string) => {
    setSelectedBackups(prev => {
      const next = new Set(prev)
      if (next.has(filePath)) {
        next.delete(filePath)
      } else {
        next.add(filePath)
      }
      return next
    })
  }

  // Start restore
  const handleRestore = async () => {
    if (!selectedServer || !selectedInstance || !databaseName.trim()) {
      appendTerminal('[ERRO] Preencha servidor, instância e nome do banco.', '#F44336')
      return
    }

    // Check security rules for restoration
    const ruleCheck = await securityRulesApi.check({
      serverName: selectedServer.name,
      instanceName: selectedInstance.name,
      databaseName: databaseName.trim(),
      operation: 'Restauração'
    })
    if (ruleCheck.hasRule) {
      appendTerminal(`[ERRO] O banco '${databaseName.trim()}' possui regra de proteção (${ruleCheck.ruleType}) e não pode ser restaurado.`, '#F44336')
      return
    }

    // Quick restore by date/time (FULL + DIFF): block if date/time missing when option is active
    if (useDiffDateRestore) {
      if (currentSettings?.showDiffDateRestore !== true) {
        appendTerminal('[ERRO] A opção "Usar DIFF de" não está habilitada em Configurações → Geral.', '#F44336')
        return
      }
      if (!diffRestoreDate || !diffRestoreTime) {
        appendTerminal('[ERRO] Preencha a data e a hora da opção "Usar DIFF de".', '#F44336')
        return
      }
    }

    const abortController = new AbortController()
    restoreAbortRef.current = abortController
    setIsRestoring(true)
    setRestoreFinished(false)
    setRestoreCompleted(false)
    setAzureRequested(triggerAzure)
    setFinalAzureStatus(null)
    clearTerminal()
    appendTerminal('[INICIANDO] Enviando requisição de restauração...', '#FFC107')

    try {
      // Determine selected backups (if any were loaded via Pesquisar)
      let selectedBackup = reuseBackup ? null : backups.find(b => selectedBackups.has(b.filePath))
      let selectedLog = includeLogDb && selectedLogBackup
        ? logBackups.find(b => b.filePath === selectedLogBackup)
        : null

      // Build the ordered list of selected DIFF backups (most recent first) to allow
      // the backend to skip a broken DIFF and use the next valid one.
      let backupFilePaths: string[] | undefined

      // Point-in-time restore (data/hora): auto-select FULL and DIFF up to the informed time
      if (useDiffDateRestore) {
        const targetTime = new Date(`${diffRestoreDate}T${diffRestoreTime}`).getTime()
        appendTerminal(`[DATA/HORA] Buscando FULL e DIFF de '${databaseName.trim()}' até ${diffRestoreDate} ${diffRestoreTime}...`, '#FFC107')
        try {
          const result: BackupSearchResponse = await restoreApi.searchBackups(databaseName.trim(), includeLogDb)
          const atTime = (b: BackupSearchResult) => new Date(b.lastBackupDate.replace(' ', 'T')).getTime() <= targetTime
          const fullAt = result.backups
            .filter(b => b.backupType === 'FULL' && atTime(b))
            .sort((a, b) => new Date(b.lastBackupDate).getTime() - new Date(a.lastBackupDate).getTime())
          const diffAt = result.backups
            .filter(b => b.backupType === 'DIFF' && atTime(b))
            .sort((a, b) => new Date(b.lastBackupDate).getTime() - new Date(a.lastBackupDate).getTime())

          if (diffAt.length > 0) {
            selectedBackup = diffAt[0]
            backupFilePaths = diffAt.map(d => d.filePath)
            appendTerminal(`[DATA/HORA] DIFF selecionado: ${selectedBackup.name} (${selectedBackup.lastBackupDate})`, '#4CAF50')
            appendTerminal(`[DATA/HORA] ${diffAt.length} DIFF(s) disponível(is) até a data/hora (mais recente → mais antigo).`, '#00BCD4')
          } else if (fullAt.length > 0) {
            selectedBackup = fullAt[0]
            appendTerminal(`[DATA/HORA] Nenhum DIFF até a data/hora. Restaurando FULL: ${selectedBackup.name} (${selectedBackup.lastBackupDate})`, '#FF9800')
          } else {
            appendTerminal('[ERRO] Nenhum backup FULL/DIFF encontrado até a data/hora informada.', '#F44336')
            return
          }

          if (includeLogDb) {
            const logFullAt = result.logBackups
              .filter(b => b.backupType === 'FULL' && atTime(b))
              .sort((a, b) => new Date(b.lastBackupDate).getTime() - new Date(a.lastBackupDate).getTime())
            if (logFullAt.length > 0) {
              selectedLog = logFullAt[0]
              appendTerminal(`[DATA/HORA] LOG selecionado: ${selectedLog.name} (${selectedLog.lastBackupDate})`, '#00BCD4')
            } else {
              selectedLog = null
              appendTerminal('[DATA/HORA] Nenhum backup LOG até a data/hora informada.', '#FF9800')
            }
          }
        } catch (error) {
          appendTerminal(`[ERRO] Falha ao buscar backups por data/hora: ${error}`, '#F44336')
          return
        }
      } else if (!reuseBackup && selectedBackups.size > 0) {
        const diffSelected = backups
          .filter(b => selectedBackups.has(b.filePath) && b.backupType === 'DIFF')
          .sort((a, b) => new Date(b.lastBackupDate).getTime() - new Date(a.lastBackupDate).getTime())
        if (diffSelected.length > 0) {
          backupFilePaths = diffSelected.map(b => b.filePath)
          // Primary backup becomes the most recent DIFF
          selectedBackup = diffSelected[0]
        }
      }

      // Auto-find the most recent backup if nothing is selected:
      // restore the _FULL base together with the most recent DIFF chain.
      // The backend tries DIFFs from most recent to oldest, skipping any broken one.
      if (!reuseBackup && !selectedBackup) {
        appendTerminal('[AUTO] Nenhum backup selecionado. Buscando FULL + DIFF mais recentes...', '#FFC107')
        try {
          const result: BackupSearchResponse = await restoreApi.searchBackups(databaseName.trim(), includeLogDb)
          const dbBackups = result.backups
          if (dbBackups.length === 0) {
            appendTerminal(`[ERRO] Nenhum backup encontrado para '${databaseName.trim()}'.`, '#F44336')
            return
          }

          const sortDesc = (arr: BackupSearchResult[]) =>
            [...arr].sort((a, b) => new Date(b.lastBackupDate).getTime() - new Date(a.lastBackupDate).getTime())

          const fullBackups = sortDesc(dbBackups.filter(b => b.backupType === 'FULL'))
          const diffBackups = sortDesc(dbBackups.filter(b => b.backupType === 'DIFF'))

          if (diffBackups.length > 0) {
            backupFilePaths = diffBackups.map(b => b.filePath)
            selectedBackup = diffBackups[0]
            appendTerminal(`[AUTO] ${diffBackups.length} DIFF(s) encadeados (mais recente → mais antigo, pulando quebrados).`, '#00BCD4')
            appendTerminal(`[AUTO] DIFF selecionado: ${selectedBackup.name} (${new Date(selectedBackup.lastBackupDate).toLocaleString('pt-BR')})`, '#4CAF50')
            if (fullBackups.length > 0) {
              appendTerminal(`[AUTO] FULL base: ${fullBackups[0].name} (${new Date(fullBackups[0].lastBackupDate).toLocaleString('pt-BR')})`, '#00BCD4')
            } else {
              appendTerminal('[AUTO] Nenhum FULL encontrado na pesquisa - o servidor buscará o FULL base para o DIFF.', '#FF9800')
            }
          } else {
            selectedBackup = fullBackups.length > 0
              ? fullBackups[0]
              : sortDesc(dbBackups)[0]
            appendTerminal(`[AUTO] Backup selecionado: ${selectedBackup.name} (${new Date(selectedBackup.lastBackupDate).toLocaleString('pt-BR')})`, '#4CAF50')
          }

          if (includeLogDb && result.logBackups.length > 0) {
            const logFull = result.logBackups.filter(b => b.backupType === 'FULL')
            const picked = (logFull.length > 0 ? logFull : result.logBackups)
              .sort((a, b) => new Date(b.lastBackupDate).getTime() - new Date(a.lastBackupDate).getTime())[0]
            selectedLog = picked
            appendTerminal(`[AUTO] Backup LOG: ${picked.name}`, '#00BCD4')
          }
        } catch (error) {
          appendTerminal(`[ERRO] Falha ao buscar backup automaticamente: ${error}`, '#F44336')
          return
        }
      }

      // Still nothing to restore
      if (!reuseBackup && !selectedBackup) {
        appendTerminal('[ERRO] Nenhum backup disponível para restauração.', '#F44336')
        return
      }

      const dbName = databaseName.trim()

      if (selectedBackup) {
        appendTerminal(`[BACKUP] ${selectedBackup.name}`, '#888888')
      }
      if (selectedLog) {
        appendTerminal(`[LOG] ${selectedLog.name}`, '#888888')
      }

      // Build restore path
      const restorePath = selectedServer.restorePath
        ? `${selectedServer.restorePath}\\${selectedInstance.name}\\${dbName}`
        : selectedInstance.restorePath
          ? `${selectedInstance.restorePath}\\${dbName}`
          : `D:\\Bases\\${selectedInstance.name}\\${dbName}`

      await restoreApi.start({
        serverName: selectedServer.name,
        instanceName: selectedInstance.name,
        databaseName: databaseName.trim(),
        backupFilePath: selectedBackup?.filePath,
        backupFilePaths,
        restorePath,
        sqlUsername: currentSettings?.sqlUsername || undefined,
        sqlPassword: currentSettings?.sqlPassword || undefined,
        verifyIntegrity,
        cleanupAfterRestore: cleanupAfter,
        triggerAzure,
        sendNotification,
        reuseBackup,
        includeLogDb,
        logBackupFilePath: selectedLog?.filePath,
      }, abortController.signal)

      // Save database name to known list for future selection
      databasesApi.addKnown(dbName).catch(() => {})
    } catch (error: any) {
      if (error.name === 'AbortError') {
        appendTerminal('[CANCELADO] Restauração cancelada pelo usuário', '#FF9800')
      } else {
        appendTerminal(`[ERRO] ${error}`, '#F44336')
      }
    } finally {
      setIsRestoring(false)
      restoreAbortRef.current = null
    }
  }

  // Update terminal when SignalR status arrives
  useEffect(() => {
    if (lastStatus) {
      appendTerminal(lastStatus.message, lastStatus.color)
    }
  }, [lastStatus])

  // Azure DevOps environment status updates (backend polling) - update in the same line
  useEffect(() => {
    if (azureStatus && azureStatus.historyIds?.length > 0) {
      const marker = `[Azure #${azureStatus.releaseId}]`
      updateTerminal(marker, `  ${marker} ${azureStatus.status}`, azureStatus.color)
    }
  }, [azureStatus, updateTerminal])

  // Derive restore progress from status messages as a fallback
  const [statusRestorePercent, setStatusRestorePercent] = useState<number | null>(null)
  useEffect(() => {
    if (!lastStatus) return
    const m = lastStatus.message.match(/(\d{1,3})\s*(?:por cento|percent)/i)
    if (m && parseInt(m[1]) < 100) {
      setStatusRestorePercent(parseInt(m[1]))
    } else if (lastStatus.message.includes('processou') || lastStatus.message.includes('remov')) {
      setStatusRestorePercent(null)
    }
  }, [lastStatus])

  // Finalize the restore progress bar at 100% only AFTER the Azure DevOps pipeline
  // reaches a terminal status (when Azure was requested). Otherwise finalize on restore complete.
  const [restoreCompleted, setRestoreCompleted] = useState(false)
  const [azureRequested, setAzureRequested] = useState(false)
  const [finalAzureStatus, setFinalAzureStatus] = useState<string | null>(null)
  const [restoreFinished, setRestoreFinished] = useState(false)

  // DB restore finished (SignalR RestoreComplete success)
  useEffect(() => {
    if (lastRestoreComplete?.success) {
      setRestoreCompleted(true)
    }
  }, [lastRestoreComplete])

  // Azure status updates: when a terminal status arrives finalize everything.
  useEffect(() => {
    if (!azureStatus || !azureStatus.historyIds?.length) return
    const terminal = ['succeeded', 'partiallysucceeded', 'rejected', 'canceled'].includes(azureStatus.rawStatus)
    if (terminal) {
      setFinalAzureStatus(azureStatus.status)
      setRestoreFinished(true)
      setRestoreCompleted(true)
    }
  }, [azureStatus])

  // No Azure -> finalize once the restore completes.
  useEffect(() => {
    if (restoreCompleted && !azureRequested) {
      setRestoreFinished(true)
    }
  }, [restoreCompleted, azureRequested])

  const azurePending = restoreCompleted && azureRequested && !restoreFinished

  // Fallback: if the Azure pipeline never reports a terminal status (backend polls
  // up to ~20 minutes), finalize anyway so the bar is not left stuck.
  useEffect(() => {
    if (!azurePending) return
    const timer = setTimeout(() => {
      setFinalAzureStatus(current => current || 'Pendente')
      setRestoreFinished(true)
    }, 15 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [azurePending])

  const isReady = selectedServer && selectedInstance && databaseName.trim()

  return (
    <div className="space-y-6">
      {/* Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Server Selection */}
        <Card title="Servidor" icon="🖥" description="Selecione o servidor SQL">
          <select
            value={selectedServer?.id || ''}
            onChange={(e) => {
              const server = servers.find(s => s.id === Number(e.target.value))
              setSelectedServer(server || null)
              setSelectedInstance(null)
              setBackups([])
            }}
            className="input"
          >
            <option value="">Selecione o servidor</option>
            {servers.map(server => (
              <option key={server.id} value={server.id}>{server.name}</option>
            ))}
          </select>
        </Card>

        {/* Instance Selection */}
        <Card title="Instância" icon="🗃" description="Selecione a instância">
          <select
            value={selectedInstance?.id || ''}
            onChange={(e) => {
              const instance = instances.find(i => i.id === Number(e.target.value))
              setSelectedInstance(instance || null)
              setBackups([])
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

        {/* Database Input */}
        <Card title="Banco de Dados" icon="💾" description={knownDatabases.length > 0 ? `${knownDatabases.length} banco(s) já utilizados (autocompletar)` : 'Nenhum banco utilizado anteriormente'}>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={databaseName}
                onChange={(e) => setDatabaseName(e.target.value)}
                placeholder="Digite ou selecione o banco"
                className="input"
                list="known-databases-list"
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <datalist id="known-databases-list">
                {knownDatabases.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>
            <button
              onClick={handleSearch}
              disabled={isSearching || !databaseName.trim()}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              {isSearching ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Buscando...
                </>
              ) : (
                <>
                  🔍 Pesquisar
                </>
              )}
            </button>
          </div>
        </Card>
      </div>

      {/* Main Content - 50/50 split between backup list and console */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Backup Selection */}
        <Card title="Backup e Restauração" icon="📁" description={`${backups.length} arquivo(s) encontrado(s)`}>
          <div className="space-y-4">
            <div className="max-h-[400px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
              {backups.length === 0 ? (
                <div className="p-8 text-center text-gray-500 dark:text-gray-400">
                  <span className="text-4xl mb-2 block">📂</span>
                  Nenhum backup encontrado
                </div>
              ) : (
                backups.map((backup) => (
                  <label
                    key={backup.filePath}
                    className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer border-b border-gray-100 dark:border-gray-700/50 last:border-0 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedBackups.has(backup.filePath)}
                      onChange={() => toggleBackup(backup.filePath)}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate" title={backup.name}>
                        {backup.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5" title={backup.filePath}>
                        {backup.filePath}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {new Date(backup.lastBackupDate).toLocaleString('pt-BR')} • {(backup.sizeKB / 1024).toFixed(1)} MB
                      </div>
                    </div>
                    <span className={`px-2 py-1 text-xs font-bold rounded flex-shrink-0 ${
                      backup.backupType === 'FULL'
                        ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400'
                        : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400'
                    }`}>
                      {backup.backupType}
                    </span>
                  </label>
                ))
              )}
            </div>

            {/* LOG Backup Selection */}
            {includeLogDb && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Backup LOG</span>
                  <span className="text-xs text-gray-500">({logBackups.length} arquivo(s))</span>
                </div>
                <div className="max-h-[200px] overflow-y-auto rounded-lg border border-amber-200 dark:border-amber-800">
                  {logBackups.length === 0 ? (
                    <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                      Nenhum backup LOG encontrado
                    </div>
                  ) : (
                    logBackups.map((backup) => (
                      <label
                        key={backup.filePath}
                        className={`flex items-center gap-3 p-2.5 cursor-pointer border-b border-amber-100 dark:border-amber-900/30 last:border-0 transition-colors ${
                          selectedLogBackup === backup.filePath
                            ? 'bg-amber-50 dark:bg-amber-900/20'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="log-backup"
                          checked={selectedLogBackup === backup.filePath}
                          onChange={() => setSelectedLogBackup(backup.filePath)}
                          className="w-4 h-4 border-gray-300 dark:border-gray-600 text-amber-600 focus:ring-amber-500 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 dark:text-white truncate" title={backup.name}>
                            {backup.name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                            {new Date(backup.lastBackupDate).toLocaleString('pt-BR')} • {(backup.sizeKB / 1024).toFixed(1)} MB
                          </div>
                        </div>
                        <span className={`px-2 py-1 text-xs font-bold rounded flex-shrink-0 ${
                          backup.backupType === 'FULL'
                            ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400'
                            : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-400'
                        }`}>
                          {backup.backupType}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Options */}
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={verifyIntegrity} onChange={(e) => setVerifyIntegrity(e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Verificar integridade</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={includeLogDb} onChange={(e) => { setIncludeLogDb(e.target.checked); if (!e.target.checked) setSelectedLogBackup('') }} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Incluir LOG</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={cleanupAfter} onChange={(e) => setCleanupAfter(e.target.checked)} disabled={reuseBackup} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 disabled:opacity-50" />
                <span className="text-gray-700 dark:text-gray-300">Limpar backups</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={reuseBackup} onChange={(e) => { setReuseBackup(e.target.checked); if (e.target.checked) setCleanupAfter(false) }} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Reaproveitar backup</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={triggerAzure} onChange={(e) => setTriggerAzure(e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Azure DevOps</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={sendNotification} onChange={(e) => setSendNotification(e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500" />
                <span className="text-gray-700 dark:text-gray-300">Notificação</span>
              </label>
              {currentSettings?.showDiffDateRestore && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useDiffDateRestore}
                    onChange={(e) => {
                      setUseDiffDateRestore(e.target.checked)
                      if (!e.target.checked) { setDiffRestoreDate(''); setDiffRestoreTime('') }
                    }}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-gray-700 dark:text-gray-300">Usar DIFF de data/hora</span>
                </label>
              )}
            </div>

            {/* Point-in-time restore date/time (shown only when enabled in settings and checked) */}
            {currentSettings?.showDiffDateRestore && useDiffDateRestore && (
              <div className="border border-dashed border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/10 rounded-lg p-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">⏳ Restaurar FULL + DIFF até a data/hora:</span>
                  <input
                    type="date"
                    value={diffRestoreDate}
                    onChange={(e) => setDiffRestoreDate(e.target.value)}
                    className="input text-sm"
                  />
                  <input
                    type="time"
                    value={diffRestoreTime}
                    onChange={(e) => setDiffRestoreTime(e.target.value)}
                    className="input text-sm"
                  />
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Busca automaticamente o DIFF mais recente até este momento e o backup FULL base correspondente. Se não houver DIFF, restaura o FULL mais recente até a data/hora.
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Console */}
        <Card title="Console" icon="💻" description="Status da operação" className="flex flex-col">
          <div className="flex-1 flex flex-col">
            <Terminal entries={terminalEntries} onClear={clearTerminal} />
          </div>
        </Card>
      </div>

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
        (isRestoring && statusRestorePercent !== null) ? (
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

      {/* Action Buttons */}
      <div className="flex items-center justify-between bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200/50 dark:border-gray-700/50 px-6 py-4">
        <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <span className={`w-2 h-2 rounded-full ${isReady ? 'bg-green-500' : 'bg-gray-400'}`}></span>
          <span>{isReady ? 'Pronto para restaurar' : 'Selecione servidor, instância e banco'}</span>
        </div>
        <div className="flex items-center gap-3">
          {isRestoring ? (
            <button
              onClick={cancelRestore}
              className="btn-danger flex items-center gap-2 px-6 py-3"
            >
              ⏹ Cancelar
            </button>
          ) : (
            <button
              onClick={handleRestore}
              disabled={!isReady}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 px-6 py-3"
            >
              ▶ Restaurar Banco
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
