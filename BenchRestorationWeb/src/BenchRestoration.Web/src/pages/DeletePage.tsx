import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serversApi, instancesApi, deleteApi, settingsApi, securityRulesApi } from '../services/api'
import Card from '../components/Card'
import ConfirmDialog from '../components/ConfirmDialog'

interface DatabaseDeleteItem {
  name: string
  sizeKB: number
  lastBackupDate: string | null
  isSelected: boolean
}

export default function DeletePage() {
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null)
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null)
  const [databases, setDatabases] = useState<DatabaseDeleteItem[]>([])
  const [isLoadingDbs, setIsLoadingDbs] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [logEntries, setLogEntries] = useState<{ text: string; color: string }[]>([])
  const [, setDeleteResult] = useState<{ successCount: number; failCount: number } | null>(null)

  const { data: servers = [] } = useQuery({
    queryKey: ['servers'],
    queryFn: serversApi.list,
  })

  const { data: instances = [] } = useQuery({
    queryKey: ['instances', selectedServerId],
    queryFn: () => instancesApi.listByServer(selectedServerId!),
    enabled: !!selectedServerId,
  })

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  const hideSelectAll = settings?.hideSelectAllInDelete ?? false

  const { data: currentSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  const selectedServer = servers.find(s => s.id === selectedServerId)
  const selectedInstance = instances.find(i => i.id === selectedInstanceId)

  const appendLog = (text: string, color: string = '#00d2ff') => {
    setLogEntries(prev => [...prev, { text, color }])
  }

  const clearLog = () => setLogEntries([])

  // Load databases from SQL Server
  const handleLoadDatabases = async () => {
    if (!selectedServer || !selectedInstance) return

    setIsLoadingDbs(true)
    setDatabases([])
    appendLog(`[INFO] Carregando bancos de '${selectedServer.name}\\${selectedInstance.name}'...`, '#00BCD4')

    try {
      const result = await deleteApi.listDatabases({
        serverName: selectedServer.name,
        instanceName: selectedInstance.name,
        username: currentSettings?.sqlUsername || undefined,
        password: currentSettings?.sqlPassword || undefined,
      })
      setDatabases(result.map((db: any) => ({ ...db, isSelected: false })))
      appendLog(`[OK] ${result.length} banco(s) carregado(s) com sucesso.`, '#4CAF50')
    } catch (error) {
      appendLog(`[ERRO] Falha ao carregar bancos: ${error}`, '#F44336')
    } finally {
      setIsLoadingDbs(false)
    }
  }

  // Toggle single database selection
  const toggleDatabase = (name: string) => {
    setDatabases(prev => prev.map(db =>
      db.name === name ? { ...db, isSelected: !db.isSelected } : db
    ))
  }

  // Toggle all databases
  const toggleAll = () => {
    const allSelected = databases.every(db => db.isSelected)
    setDatabases(prev => prev.map(db => ({ ...db, isSelected: !allSelected })))
  }

  // Delete selected databases
  const handleDelete = async () => {
    if (!selectedServer || !selectedInstance) return

    const selectedDbs = databases.filter(db => db.isSelected)
    if (selectedDbs.length === 0) return

    setIsDeleting(true)
    setDeleteResult(null)
    clearLog()

    appendLog(`[INFO] Iniciando exclusão de ${selectedDbs.length} banco(s)...`, '#FFEB3B')

    // Pre-check security rules and show warnings
    for (const db of selectedDbs) {
      try {
        const ruleCheck = await securityRulesApi.check({
          serverName: selectedServer.name,
          instanceName: selectedInstance.name,
          databaseName: db.name,
          operation: 'Exclusão'
        })
        if (ruleCheck.hasRule) {
          appendLog(`[AVISO] O banco '${db.name}' possui regra de proteção (${ruleCheck.ruleType}) e será ignorado.`, '#FF9800')
        }
      } catch {
        // Backend will handle the final check
      }
    }

    // Send all selected databases to the backend so it can record blocked/success/failure in history.
    // The backend re-validates security rules and will skip blocked ones.
    const dbNamesToDelete = selectedDbs.map(db => db.name)
    if (dbNamesToDelete.length === 0) {
      appendLog('[OK] Nenhum banco para excluir - todos possuem regras de proteção.', '#FF9800')
      setIsDeleting(false)
      setShowConfirm(false)
      return
    }

    try {
      const result = await deleteApi.dropDatabases({
        serverName: selectedServer.name,
        instanceName: selectedInstance.name,
        databaseNames: dbNamesToDelete,
        username: currentSettings?.sqlUsername || undefined,
        password: currentSettings?.sqlPassword || undefined,
      })

      setDeleteResult({ successCount: result.successCount, failCount: result.failCount })

      result.messages.forEach((msg: string) => {
        const color = msg.includes('[OK]') ? '#4CAF50' : msg.includes('[ERRO]') ? '#F44336' : '#00BCD4'
        appendLog(msg, color)
      })

      appendLog(`[OK] Exclusão concluída: ${result.successCount} sucesso, ${result.failCount} falha`, '#4CAF50')

      // Reload database list
      await handleLoadDatabases()
    } catch (error) {
      appendLog(`[ERRO] Falha na exclusão: ${error}`, '#F44336')
    } finally {
      setIsDeleting(false)
      setShowConfirm(false)
    }
  }

  const selectedCount = databases.filter(db => db.isSelected).length
  const allSelected = databases.length > 0 && databases.every(db => db.isSelected)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Excluir Banco de Dados
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Selecione o servidor, instância e carregue os bancos para exclusão
        </p>
      </div>

      {/* Selection Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Servidor" icon="🖥" description="Selecione o servidor SQL">
          <select
            value={selectedServerId || ''}
            onChange={(e) => {
              setSelectedServerId(Number(e.target.value) || null)
              setSelectedInstanceId(null)
              setDatabases([])
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
            value={selectedInstanceId || ''}
            onChange={(e) => {
              setSelectedInstanceId(Number(e.target.value) || null)
              setDatabases([])
            }}
            disabled={!selectedServerId}
            className="input disabled:opacity-50"
          >
            <option value="">Selecione a instância</option>
            {instances.map(instance => (
              <option key={instance.id} value={instance.id}>{instance.displayName || instance.name}</option>
            ))}
          </select>
        </Card>

        <Card title="Ação" icon="🔍" description="Carregue os bancos">
          <button
            onClick={handleLoadDatabases}
            disabled={!selectedServer || !selectedInstance || isLoadingDbs}
            className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoadingDbs ? (
              <>
                <span className="animate-spin">⏳</span>
                Carregando...
              </>
            ) : (
              <>
                🔄 Carregar Bancos
              </>
            )}
          </button>
        </Card>
      </div>

      {/* Database List */}
      {databases.length > 0 && (
        <Card title="Bancos de Dados" icon="💾" description={`${databases.length} banco(s) encontrado(s)`}
          headerAction={
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {selectedCount} selecionado(s)
              </span>
              <button
                onClick={() => setShowConfirm(true)}
                disabled={selectedCount === 0 || isDeleting}
                className="btn-danger disabled:opacity-50"
              >
                🗑️ Excluir Selecionados
              </button>
            </div>
          }
        >
          {/* Select All */}
          {!hideSelectAll && <div className="flex items-center gap-3 pb-3 border-b border-gray-200 dark:border-gray-700 mb-3">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Selecionar todos</span>
          </div>}

          {/* Database Items */}
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {databases.map((db) => (
              <label
                key={db.name}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={db.isSelected}
                  onChange={() => toggleDatabase(db.name)}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                />
                <div className="flex-1 grid grid-cols-3 gap-4">
                  <div className="font-medium text-gray-900 dark:text-white">{db.name}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {(db.sizeKB / 1024).toFixed(1)} MB
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {db.lastBackupDate ? new Date(db.lastBackupDate).toLocaleString('pt-BR') : 'Sem backup'}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </Card>
      )}

      {/* Log Output */}
      <Card title="Log" icon="📋" description="Status da operação">
        <div className="bg-gray-950 rounded-lg p-4 h-48 overflow-y-auto font-mono text-sm">
          {logEntries.length === 0 ? (
            <div className="text-gray-600 flex items-center gap-2">
              <span className="text-green-500">{'>'}</span>
              <span>Aguardando operação...</span>
            </div>
          ) : (
            logEntries.map((entry, index) => (
              <div key={index} className="py-0.5 flex items-start gap-2">
                <span className="text-gray-600 select-none">{'>'}</span>
                <span style={{ color: entry.color }}>{entry.text}</span>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={clearLog} className="btn-secondary text-sm">
            Limpar Log
          </button>
        </div>
      </Card>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirm}
        title="Confirmar Exclusão"
        variant="danger"
        message={
          <div>
            <p className="mb-2">Tem certeza que deseja excluir {selectedCount} banco(s)?</p>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 font-mono text-sm max-h-40 overflow-y-auto">
              {databases.filter(db => db.isSelected).map((db, i) => (
                <div key={i} className="text-gray-900 dark:text-white">• {db.name}</div>
              ))}
            </div>
            <p className="mt-3 text-red-600 dark:text-red-400 font-semibold text-sm">
              ⚠️ Esta ação não pode ser desfeita!
            </p>
          </div>
        }
        confirmLabel={`Excluir ${selectedCount} banco(s)`}
        loading={isDeleting}
        loadingLabel={`Excluindo ${selectedCount} banco(s)...`}
        onConfirm={handleDelete}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}
