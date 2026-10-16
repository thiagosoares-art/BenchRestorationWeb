import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { settingsApi, backupSourcesApi, serversApi, instancesApi, testApi, securityRulesApi, postRestoreScriptsApi, authApi } from '../services/api'
import type { Server, Instance, ConfigExport, ConfigExportRaw } from '../types'
import { useAuth } from '../contexts/AuthContext'

type SettingsSection = 'general' | 'servers' | 'backup' | 'azure' | 'notifications' | 'credentials' | 'security' | 'usuarios' | 'scripts' | 'importexport' | 'about'

const sections = [
  { id: 'general' as SettingsSection, label: 'Geral', icon: '🏠', description: 'Configurações principais' },
  { id: 'servers' as SettingsSection, label: 'Servidores e Instâncias', icon: '🖥️', description: 'Gerenciar servidores SQL' },
  { id: 'backup' as SettingsSection, label: 'Caminhos de Backup', icon: '📂', description: 'Pastas compartilhadas' },
  { id: 'azure' as SettingsSection, label: 'Azure DevOps', icon: '☁️', description: 'Pipelines e integração' },
  { id: 'notifications' as SettingsSection, label: 'Notificações', icon: '🔔', description: 'Alertas e destinatários' },
  { id: 'credentials' as SettingsSection, label: 'Credenciais', icon: '🔑', description: 'Acessos e autenticações' },
  { id: 'security' as SettingsSection, label: 'Segurança', icon: '🛡️', description: 'Políticas e permissões' },
  { id: 'usuarios' as SettingsSection, label: 'Usuários', icon: '👥', description: 'Gerenciar usuários do sistema' },
  { id: 'scripts' as SettingsSection, label: 'Scripts Pós-Restauração', icon: '📜', description: 'Scripts executados após restore' },
  { id: 'importexport' as SettingsSection, label: 'Importar/Exportar', icon: '📦', description: 'Backup das configurações' },
  { id: 'about' as SettingsSection, label: 'Sobre', icon: 'ℹ️', description: 'Informações do sistema' },
]

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const [isTestingAll, setIsTestingAll] = useState(false)
  const [isGeneratingBackup, setIsGeneratingBackup] = useState(false)

  // Form states
  const [newBackupSource, setNewBackupSource] = useState('')
  const [newServerName, setNewServerName] = useState('')
  const [newServerBackupPath, setNewServerBackupPath] = useState('')
  const [newServerRestorePath, setNewServerRestorePath] = useState('')
  const [editingServer, setEditingServer] = useState<Server | null>(null)
  const [newInstanceName, setNewInstanceName] = useState('')
  const [newInstancePipelineId, setNewInstancePipelineId] = useState('')
  const [editingInstance, setEditingInstance] = useState<Instance | null>(null)
  const [editInstanceName, setEditInstanceName] = useState('')
  const [editInstanceDisplayName, setEditInstanceDisplayName] = useState('')
  const [editInstanceUsername, setEditInstanceUsername] = useState('')
  const [editInstancePassword, setEditInstancePassword] = useState('')
  const [editInstanceRestorePath, setEditInstanceRestorePath] = useState('')
  const [editInstancePipelineId, setEditInstancePipelineId] = useState('')
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null)
  const [searchText, setSearchText] = useState('')

  // Settings form
  const [settings, setSettings] = useState({
    backupDestination: '',
    defaultRestoreBasePath: '',
    azureDevOpsToken: '',
    azureDevOpsUrl: '',
    azureReleaseDefinitionId: 0,
    notificationApiUrl: '',
    sqlUsername: '',
    sqlPassword: '',
    networkUsername: '',
    networkPassword: '',
    defaultIncludeLogDatabase: false,
    showDiffDateRestore: false,
    scriptsRestoreBasePath: '',
    hideSelectAllInDelete: false,
    deleteExceptionDatabases: '',
    restoreExceptionDatabases: '',
  })

  // Password visibility toggles
  const [showSqlPassword, setShowSqlPassword] = useState(false)
  const [showNetworkPassword, setShowNetworkPassword] = useState(false)

  // Connection status
  const [sqlConnectionStatus, setSqlConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [networkConnectionStatus, setNetworkConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [notificationConnectionStatus, setNotificationConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [azureConnectionStatus, setAzureConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')

  // Import/Export
  const [importPreview, setImportPreview] = useState<ConfigExport | null>(null)
  const [exportGeneral, setExportGeneral] = useState(true)
  const [exportServers, setExportServers] = useState(true)
  const [exportBackupPaths, setExportBackupPaths] = useState(true)
  const [exportAzureDevOps, setExportAzureDevOps] = useState(true)
  const [exportNotifications, setExportNotifications] = useState(true)
  const [exportCredentials, setExportCredentials] = useState(true)
  const [exportSecurity, setExportSecurity] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Security rules form
  const [securityRuleServer, setSecurityRuleServer] = useState<Server | null>(null)
  const [securityRuleInstance, setSecurityRuleInstance] = useState<Instance | null>(null)
  const [securityRuleDatabase, setSecurityRuleDatabase] = useState('')
  const [securityRuleType, setSecurityRuleType] = useState('Exclusão')

  // Security rules filter
  const [securityFilterServer, setSecurityFilterServer] = useState<string>('')  // '' = Nenhum, 'all' = Todos, ou id
  const [securityFilterInstance, setSecurityFilterInstance] = useState<string>('')  // '' = Nenhum, 'all' = Todas, ou id

  const { data: securityRuleInstances = [] } = useQuery({
    queryKey: ['instances', securityRuleServer?.id],
    queryFn: () => instancesApi.listByServer(securityRuleServer!.id),
    enabled: !!securityRuleServer,
  })

  const filterServerId = securityFilterServer && securityFilterServer !== 'all' ? Number(securityFilterServer) : null
  const { data: securityFilterInstances = [] } = useQuery({
    queryKey: ['instances', filterServerId],
    queryFn: () => instancesApi.listByServer(filterServerId!),
    enabled: filterServerId != null,
  })

  // Post-restore scripts form
  const [scriptDatabaseName, setScriptDatabaseName] = useState('')
  const [scriptPath, setScriptPath] = useState('')
  const [scriptSortOrder, setScriptSortOrder] = useState(0)

  // Queries
  const { data: currentSettings, isLoading: isSettingsLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  const { data: backupSources = [], isLoading: isBackupLoading } = useQuery({
    queryKey: ['backupSources'],
    queryFn: backupSourcesApi.list,
  })

  const { data: servers = [], isLoading: isServersLoading } = useQuery({
    queryKey: ['servers'],
    queryFn: serversApi.list,
  })

  const { data: instances = [] } = useQuery({
    queryKey: ['instances', selectedServerId],
    queryFn: () => instancesApi.listByServer(selectedServerId!),
    enabled: !!selectedServerId,
  })

  const { data: securityRules = [] } = useQuery({
    queryKey: ['securityRules'],
    queryFn: securityRulesApi.list,
  })

  // Filtered security rules based on selected server/instance
  const filteredSecurityRules = useMemo(() => {
    // Default 'Nenhum' -> show nothing until a real filter is chosen
    if (!securityFilterServer || securityFilterServer === '') return []
    if (securityFilterServer !== 'all' && !securityFilterInstance) return []
    const serverName = securityFilterServer === 'all' ? null : servers.find(s => s.id === Number(securityFilterServer))?.name || null
    const instanceName = securityFilterInstance === 'all' ? null : (securityFilterInstance ? securityFilterInstances.find(i => i.id === Number(securityFilterInstance))?.name || null : null)
    return securityRules.filter((rule: any) => {
      if (serverName && rule.serverName !== serverName) return false
      if (instanceName && rule.instanceName !== instanceName) return false
      return true
    })
  }, [securityRules, securityFilterServer, securityFilterInstance, securityFilterInstances, servers])

  const { data: postRestoreScripts = [] } = useQuery({
    queryKey: ['postRestoreScripts'],
    queryFn: postRestoreScriptsApi.list,
  })

  // Update settings when loaded
  useEffect(() => {
    if (currentSettings) {
      setSettings({
        backupDestination: currentSettings.backupDestination ?? '',
        defaultRestoreBasePath: currentSettings.defaultRestoreBasePath ?? '',
        azureDevOpsToken: currentSettings.azureDevOpsToken ?? '',
        azureDevOpsUrl: currentSettings.azureDevOpsUrl ?? '',
        azureReleaseDefinitionId: currentSettings.azureReleaseDefinitionId ?? 0,
        notificationApiUrl: currentSettings.notificationApiUrl ?? '',
        sqlUsername: currentSettings.sqlUsername ?? '',
        sqlPassword: currentSettings.sqlPassword ?? '',
        networkUsername: currentSettings.networkUsername ?? '',
        networkPassword: currentSettings.networkPassword ?? '',
        defaultIncludeLogDatabase: currentSettings.defaultIncludeLogDatabase ?? false,
        showDiffDateRestore: currentSettings.showDiffDateRestore ?? false,
        scriptsRestoreBasePath: currentSettings.scriptsRestoreBasePath ?? '',
        hideSelectAllInDelete: currentSettings.hideSelectAllInDelete ?? false,
        deleteExceptionDatabases: currentSettings.deleteExceptionDatabases ?? '',
        restoreExceptionDatabases: currentSettings.restoreExceptionDatabases ?? '',
      })
    }
  }, [currentSettings])

  // Filter sections based on search
  const filteredSections = searchText
    ? sections.filter(s =>
        s.label.toLowerCase().includes(searchText.toLowerCase()) ||
        s.description.toLowerCase().includes(searchText.toLowerCase())
      )
    : sections

  // Handlers
  const handleGenerateBackup = async () => {
    setIsGeneratingBackup(true)
    try {
      const result = await backupSourcesApi.generate()
      toast.success(result.message || 'Backup gerado com sucesso!')
    } catch (error) {
      console.error('Erro ao gerar backup:', error)
      toast.error('Erro ao gerar backup')
    } finally {
      setIsGeneratingBackup(false)
    }
  }

  const handleSaveSettings = async () => {
    try {
      await settingsApi.update(settings)
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Configurações salvas com sucesso!')
    } catch (error) {
      console.error('Erro ao salvar configurações:', error)
      toast.error('Erro ao salvar configurações')
    }
  }

  const handleTestAll = async () => {
    setIsTestingAll(true)
    await Promise.all([
      handleTestSqlConnection(),
      handleTestNetworkConnection(),
      handleTestNotificationConnection(),
      handleTestAzureConnection(),
    ])
    setIsTestingAll(false)
    toast.success('Testes concluídos!')
  }

  const handleTestSqlConnection = async () => {
    setSqlConnectionStatus('testing')
    try {
      const result = await testApi.sqlConnection({
        serverName: servers[0]?.name || '',
        instanceName: instances[0]?.name || '',
        username: settings.sqlUsername,
        password: settings.sqlPassword,
      })
      setSqlConnectionStatus(result.success ? 'success' : 'error')
    } catch {
      setSqlConnectionStatus('error')
    }
  }

  const handleTestNetworkConnection = async () => {
    setNetworkConnectionStatus('testing')
    try {
      const result = await testApi.networkConnection({
        path: backupSources[0]?.sharePath || '',
        username: settings.networkUsername || '',
        password: settings.networkPassword || '',
      })
      setNetworkConnectionStatus(result.success ? 'success' : 'error')
    } catch {
      setNetworkConnectionStatus('error')
    }
  }

  const handleTestNotificationConnection = async () => {
    setNotificationConnectionStatus('testing')
    try {
      const result = await testApi.notificationApi(settings.notificationApiUrl || '')
      setNotificationConnectionStatus(result.success ? 'success' : 'error')
    } catch {
      setNotificationConnectionStatus('error')
    }
  }

  const handleTestAzureConnection = async () => {
    setAzureConnectionStatus('testing')
    try {
      const result = await testApi.azureConnection({
        token: settings.azureDevOpsToken || '',
        url: settings.azureDevOpsUrl || '',
      }) as { success: boolean; message: string; postPreview?: string }
      setAzureConnectionStatus(result.success ? 'success' : 'error')
      if (result.message) {
        toast(result.message, { duration: 8000 })
      }
      if (result.postPreview) {
        toast(`POST Response: ${result.postPreview.substring(0, 200)}`, { duration: 8000 })
      }
    } catch {
      setAzureConnectionStatus('error')
      toast.error('Erro ao testar conexão Azure DevOps')
    }
  }

  const handleAddBackupSource = async () => {
    if (!newBackupSource.trim()) return
    try {
      await backupSourcesApi.create({ sharePath: newBackupSource.trim() })
      setNewBackupSource('')
      await queryClient.invalidateQueries({ queryKey: ['backupSources'] })
      toast.success('Fonte de backup adicionada com sucesso!')
    } catch (error) {
      console.error('Erro ao adicionar fonte de backup:', error)
      toast.error('Erro ao adicionar fonte de backup')
    }
  }

  const handleRemoveBackupSource = async (id: number) => {
    try {
      await backupSourcesApi.delete(id)
      await queryClient.invalidateQueries({ queryKey: ['backupSources'] })
      toast.success('Fonte de backup removida!')
    } catch (error) {
      console.error('Erro ao remover fonte de backup:', error)
      toast.error('Erro ao remover fonte de backup')
    }
  }

  const handleAddServer = async () => {
    if (!newServerName.trim()) return
    try {
      await serversApi.create({
        name: newServerName.trim(),
        backupPath: newServerBackupPath.trim() || undefined,
        restorePath: newServerRestorePath.trim() || undefined,
      })
      setNewServerName('')
      setNewServerBackupPath('')
      setNewServerRestorePath('')
      await queryClient.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Servidor adicionado com sucesso!')
    } catch (error) {
      console.error('Erro ao adicionar servidor:', error)
      toast.error('Erro ao adicionar servidor')
    }
  }

  const handleEditServer = (server: Server) => {
    setEditingServer(server)
    setNewServerName(server.name)
    setNewServerBackupPath(server.backupPath || '')
    setNewServerRestorePath(server.restorePath || '')
  }

  const handleSaveServerEdit = async () => {
    if (!editingServer || !newServerName.trim()) return
    try {
      await serversApi.update(editingServer.id, {
        name: newServerName.trim(),
        backupPath: newServerBackupPath.trim() || undefined,
        restorePath: newServerRestorePath.trim() || undefined,
      })
      setEditingServer(null)
      setNewServerName('')
      setNewServerBackupPath('')
      setNewServerRestorePath('')
      await queryClient.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Servidor atualizado com sucesso!')
    } catch (error) {
      console.error('Erro ao atualizar servidor:', error)
      toast.error('Erro ao atualizar servidor')
    }
  }

  const handleCancelServerEdit = () => {
    setEditingServer(null)
    setNewServerName('')
    setNewServerBackupPath('')
    setNewServerRestorePath('')
  }

  const handleRemoveServer = async (id: number) => {
    try {
      await serversApi.delete(id)
      await queryClient.invalidateQueries({ queryKey: ['servers'] })
      toast.success('Servidor removido!')
    } catch (error) {
      console.error('Erro ao remover servidor:', error)
      toast.error('Erro ao remover servidor')
    }
  }

  const handleAddInstance = async () => {
    if (!selectedServerId || !newInstanceName.trim()) return
    try {
      await instancesApi.create({
        id: 0,
        serverId: selectedServerId,
        name: newInstanceName.trim(),
        displayName: `${servers.find(s => s.id === selectedServerId)?.name}\\${newInstanceName.trim()}`,
        authType: 'Windows',
        azureReleaseDefinitionId: parseInt(newInstancePipelineId) || 0,
      })
      setNewInstanceName('')
      setNewInstancePipelineId('')
      await queryClient.invalidateQueries({ queryKey: ['instances', selectedServerId] })
      toast.success('Instância adicionada com sucesso!')
    } catch (error) {
      console.error('Erro ao adicionar instância:', error)
      toast.error('Erro ao adicionar instância')
    }
  }

  const handleRemoveInstance = async (id: number) => {
    try {
      await instancesApi.delete(id)
      await queryClient.invalidateQueries({ queryKey: ['instances', selectedServerId] })
      toast.success('Instância removida!')
    } catch (error) {
      console.error('Erro ao remover instância:', error)
      toast.error('Erro ao remover instância')
    }
  }

  const handleEditInstance = (instance: Instance) => {
    setEditingInstance(instance)
    setEditInstanceName(instance.name)
    setEditInstanceDisplayName(instance.displayName || '')
    setEditInstanceUsername(instance.username || '')
    setEditInstancePassword('')
    setEditInstanceRestorePath(instance.restorePath || '')
    setEditInstancePipelineId(instance.azureReleaseDefinitionId ? String(instance.azureReleaseDefinitionId) : '')
  }

  const handleSaveInstanceEdit = async () => {
    if (!editingInstance || !editInstanceName.trim()) return
    try {
      await instancesApi.update(editingInstance.id, {
        ...editingInstance,
        name: editInstanceName.trim(),
        displayName: editInstanceDisplayName.trim() || undefined,
        username: editInstanceUsername.trim() || undefined,
        passwordEnc: editInstancePassword.trim() || editingInstance.passwordEnc,
        restorePath: editInstanceRestorePath.trim() || undefined,
        azureReleaseDefinitionId: parseInt(editInstancePipelineId) || 0,
      })
      setEditingInstance(null)
      await queryClient.invalidateQueries({ queryKey: ['instances', selectedServerId] })
      toast.success('Instância atualizada com sucesso!')
    } catch (error) {
      console.error('Erro ao atualizar instância:', error)
      toast.error('Erro ao atualizar instância')
    }
  }

  const handleCancelInstanceEdit = () => {
    setEditingInstance(null)
  }

  const handleAddSecurityRule = async () => {
    if (!securityRuleServer || !securityRuleInstance || !securityRuleDatabase.trim()) return
    try {
      await securityRulesApi.create({
        serverName: securityRuleServer.name,
        instanceName: securityRuleInstance.name,
        databaseName: securityRuleDatabase.trim(),
        ruleType: securityRuleType,
      })
      setSecurityRuleDatabase('')
      await queryClient.invalidateQueries({ queryKey: ['securityRules'] })
      toast.success('Regra de segurança adicionada com sucesso!')
    } catch (error) {
      console.error('Erro ao adicionar regra de segurança:', error)
      toast.error('Erro ao adicionar regra de segurança')
    }
  }

  const handleRemoveSecurityRule = async (id: number) => {
    try {
      await securityRulesApi.delete(id)
      await queryClient.invalidateQueries({ queryKey: ['securityRules'] })
      toast.success('Regra de segurança removida!')
    } catch (error) {
      console.error('Erro ao remover regra de segurança:', error)
      toast.error('Erro ao remover regra de segurança')
    }
  }

  // Post-restore scripts handlers
  const handleAddScript = async () => {
    if (!scriptDatabaseName.trim() || !scriptPath.trim()) return
    try {
      await postRestoreScriptsApi.create({
        databaseName: scriptDatabaseName.trim(),
        scriptPath: scriptPath.trim(),
        sortOrder: scriptSortOrder,
      })
      setScriptDatabaseName('')
      setScriptPath('')
      setScriptSortOrder(0)
      await queryClient.invalidateQueries({ queryKey: ['postRestoreScripts'] })
      toast.success('Script adicionado com sucesso!')
    } catch (error) {
      console.error('Erro ao adicionar script:', error)
      toast.error('Erro ao adicionar script')
    }
  }

  const handleRemoveScript = async (id: number) => {
    try {
      await postRestoreScriptsApi.delete(id)
      await queryClient.invalidateQueries({ queryKey: ['postRestoreScripts'] })
      toast.success('Script removido!')
    } catch (error) {
      console.error('Erro ao remover script:', error)
      toast.error('Erro ao remover script')
    }
  }

  // User management
  const { isAdmin, user } = useAuth()
  const [newUserUsername, setNewUserUsername] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [newUserRole, setNewUserRole] = useState('Usuario')
  const [newUserPermissions, setNewUserPermissions] = useState<string[]>([])
  const [editingUser, setEditingUser] = useState<any>(null)
  const [editingUserPassword, setEditingUserPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const allPermissions = [
    { key: 'restaurar', label: 'Restaurar' },
    { key: 'historico', label: 'Histórico' },
    { key: 'lote', label: 'Lote' },
    { key: 'excluir', label: 'Excluir' },
    { key: 'fila', label: 'Fila' },
    { key: 'servidor', label: 'Servidor' },
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'configuracoes', label: 'Configurações' },
  ]

  const { data: users = [], refetch: refetchUsers } = useQuery({
    queryKey: ['users'],
    queryFn: authApi.listUsers,
    enabled: isAdmin,
  })

  const handleTogglePermission = (perm: string) => {
    setNewUserPermissions(prev =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    )
  }

  const handleCreateUser = async () => {
    if (!newUserUsername.trim() || !newUserPassword.trim()) {
      toast.error('Preencha usuário e senha')
      return
    }
    try {
      await authApi.createUser({
        username: newUserUsername.trim(),
        password: newUserPassword,
        role: newUserRole,
        permissions: newUserPermissions,
      })
      setNewUserUsername('')
      setNewUserPassword('')
      setNewUserRole('Usuario')
      setNewUserPermissions([])
      await refetchUsers()
      toast.success('Usuário criado com sucesso!')
    } catch (error: any) {
      toast.error(error.message || 'Erro ao criar usuário')
    }
  }

  const handleEditUser = (user: any) => {
    setEditingUser(user)
    setNewUserUsername(user.username)
    setNewUserRole(user.role)
    setNewUserPermissions(user.permissions || [])
    setEditingUserPassword('')
  }

  const handleSaveUser = async () => {
    if (!editingUser) return
    try {
      await authApi.updateUser(editingUser.id, {
        password: editingUserPassword || undefined,
        role: newUserRole,
        permissions: newUserPermissions,
      })
      setEditingUser(null)
      setNewUserUsername('')
      setEditingUserPassword('')
      await refetchUsers()
      toast.success('Usuário atualizado com sucesso!')
    } catch (error: any) {
      toast.error(error.message || 'Erro ao atualizar usuário')
    }
  }

  const handleDeleteUser = async (id: number) => {
    if (!window.confirm('Tem certeza que deseja excluir este usuário?')) return
    try {
      await authApi.deleteUser(id)
      await refetchUsers()
      toast.success('Usuário excluído!')
    } catch (error: any) {
      toast.error(error.message || 'Erro ao excluir usuário')
    }
  }

  const handleToggleUserActive = async (user: any) => {
    try {
      await authApi.updateUser(user.id, { isActive: !user.isActive })
      await refetchUsers()
      toast.success(`Usuário ${user.isActive ? 'desativado' : 'ativado'} com sucesso!`)
    } catch (error: any) {
      toast.error(error.message || 'Erro ao alterar status do usuário')
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      toast.error('Preencha a senha atual e a nova senha')
      return
    }
    try {
      const result = await authApi.changePassword({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      toast.success(result.message || 'Senha alterada com sucesso!')
    } catch (error: any) {
      toast.error(error.message || 'Erro ao alterar senha')
    }
  }

  // Export settings
  const handleExport = async () => {
    try {
      const config: ConfigExport = {
        version: '2.0.0',
        exportDate: new Date().toISOString(),
        settings: {} as Record<string, string | null>,
        servers: [],
        instances: [],
        backupSources: [],
      }

      if (exportGeneral) {
        config.settings['BackupDestination'] = settings.backupDestination
        config.settings['DefaultRestoreBasePath'] = settings.defaultRestoreBasePath
        config.settings['DefaultIncludeLogDatabase'] = settings.defaultIncludeLogDatabase ? 'true' : 'false'
        config.settings['ShowDiffDateRestore'] = settings.showDiffDateRestore ? 'true' : 'false'
        config.settings['ScriptsRestoreBasePath'] = settings.scriptsRestoreBasePath
        config.settings['Theme'] = currentSettings?.theme ?? ''
      }
      if (exportCredentials) {
        config.settings['SqlUsername'] = settings.sqlUsername
        config.settings['SqlPassword'] = settings.sqlPassword
        config.settings['NetworkUsername'] = settings.networkUsername
        config.settings['NetworkPassword'] = settings.networkPassword
      }
      if (exportAzureDevOps) {
        config.settings['AzureDevOpsToken'] = settings.azureDevOpsToken
        config.settings['AzureDevOpsUrl'] = settings.azureDevOpsUrl
        config.settings['AzureReleaseDefinitionId'] = settings.azureReleaseDefinitionId.toString()
      }
      if (exportNotifications) {
        config.settings['NotificationApiUrl'] = settings.notificationApiUrl
      }
      if (exportSecurity) {
        config.settings['HideSelectAllInDelete'] = settings.hideSelectAllInDelete ? 'true' : 'false'
        config.settings['DeleteExceptionDatabases'] = settings.deleteExceptionDatabases
        config.settings['RestoreExceptionDatabases'] = settings.restoreExceptionDatabases
      }
      if (exportServers) {
        config.servers = servers
        // Aggregate instances from ALL servers (not just the selected one)
        const allInstances: Instance[] = []
        for (const server of servers) {
          try {
            const serverInstances = await instancesApi.listByServer(server.id)
            allInstances.push(...serverInstances)
          } catch {
            // Ignore a server that fails to load its instances
          }
        }
        config.instances = allInstances
      }
      if (exportBackupPaths) {
        config.backupSources = backupSources
      }

      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `benchrestoration-config-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Configurações exportadas com sucesso!')
    } catch (error) {
      toast.error('Erro ao exportar configurações')
    }
  }

  // Import settings - normalize both camelCase (web export) and PascalCase (desktop export)
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const raw: ConfigExportRaw = JSON.parse(event.target?.result as string)

        const servers = raw.Servers || raw.servers || []
        const instances = raw.Instances || raw.instances || []
        const backupSources = raw.BackupSources || raw.backupSources || []

        const config: ConfigExport = {
          version: raw.Version || raw.version || '1.0',
          exportDate: raw.ExportDate || raw.exportDate || new Date().toISOString(),
          settings: raw.Settings || raw.settings || {},
          servers: servers.map((s) => ({
            id: s.Id || s.id || 0,
            name: s.Name || s.name || '',
            description: s.Description ?? s.description ?? undefined,
            backupPath: s.BackupPath ?? s.backupPath ?? undefined,
            restorePath: s.RestorePath ?? s.restorePath ?? undefined,
          })),
          instances: instances.map((i) => ({
            id: i.Id || i.id || 0,
            serverId: i.ServerId || i.serverId || 0,
            name: i.Name || i.name || '',
            displayName: i.DisplayName || i.displayName || '',
            authType: i.AuthType || i.authType || 'Windows',
            username: i.Username ?? i.username ?? undefined,
            passwordEnc: i.PasswordEnc ?? i.passwordEnc ?? undefined,
            restorePath: i.RestorePath ?? i.restorePath ?? undefined,
            azureReleaseDefinitionId: i.AzureReleaseDefinitionId || i.azureReleaseDefinitionId || 0,
          })),
          backupSources: backupSources.map((b) => ({
            id: b.Id || b.id || 0,
            sharePath: b.SharePath || b.sharePath || '',
            description: b.Description ?? b.description ?? undefined,
            isActive: b.IsActive ?? b.isActive ?? true,
          })),
        }

        setImportPreview(config)
      } catch {
        toast.error('Arquivo JSON inválido')
      }
    }
    reader.readAsText(file)
  }

  const handleApplyImport = async () => {
    if (!importPreview) return

    try {
      const result = await settingsApi.importConfig({
        version: importPreview.version,
        exportDate: importPreview.exportDate,
        settings: importPreview.settings,
        servers: importPreview.servers,
        instances: importPreview.instances,
        backupSources: importPreview.backupSources,
      }) as { message?: string; errors?: string[] }

      queryClient.invalidateQueries()
      setImportPreview(null)

      if (result.errors && result.errors.length > 0) {
        toast.success(result.message || 'Importação parcial concluída')
        // Show first few errors
        result.errors.slice(0, 3).forEach(err => toast.error(err, { duration: 6000 }))
        if (result.errors.length > 3) {
          toast.error(`... e mais ${result.errors.length - 3} erro(s)`, { duration: 6000 })
        }
      } else {
        toast.success(result.message || 'Configurações importadas com sucesso!')
      }
    } catch (error) {
      toast.error('Erro ao importar configurações')
    }
  }

  const isLoading = isSettingsLoading || isBackupLoading || isServersLoading

  return (
    <div className="min-h-[calc(100vh-8rem)] flex flex-col">
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
            <span className="animate-spin text-xl">⏳</span>
            <span>Carregando configurações...</span>
          </div>
        </div>
      ) : (
      <>
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-t-xl border border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900 rounded-xl flex items-center justify-center">
            <span className="text-2xl">⚙️</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Configurações</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Gerencie todas as configurações do sistema</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={handleTestAll} disabled={isTestingAll} className="btn-secondary flex items-center gap-2 disabled:opacity-50">
            {isTestingAll ? <span className="animate-spin">⏳</span> : <span>✓</span>}
            Testar Tudo
          </button>
          <button onClick={handleSaveSettings} className="btn-primary flex items-center gap-2">💾 Salvar</button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 bg-white dark:bg-gray-800 border-x border-b border-gray-200 dark:border-gray-700 rounded-b-xl">
        {/* Sidebar */}
        <div className="w-64 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 p-4 shrink-0 self-start">
          <div className="mb-4">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="🔍 Buscar configurações..."
              className="input text-sm"
            />
          </div>
          <nav className="space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left transition-all ${
                  activeSection === section.id
                    ? 'bg-primary-600 text-white shadow-md'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <span className="text-lg">{section.icon}</span>
                <div>
                  <div className="font-medium text-sm">{section.label}</div>
                  <div className="text-xs opacity-75">{section.description}</div>
                </div>
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto min-h-0">
          {/* General Section */}
          {activeSection === 'general' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">🏠</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Geral</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Configurações principais do sistema</p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Configurações Gerais</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Opções padrão do sistema</p>

                <label className="flex items-center gap-3 cursor-pointer mb-4">
                  <input
                    type="checkbox"
                    checked={settings.defaultIncludeLogDatabase}
                    onChange={(e) => setSettings({ ...settings, defaultIncludeLogDatabase: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-gray-700 dark:text-gray-300">Incluir banco de LOG por padrão ao iniciar</span>
                </label>

                <label className="flex items-center gap-3 cursor-pointer mb-4">
                  <input
                    type="checkbox"
                    checked={settings.showDiffDateRestore}
                    onChange={(e) => setSettings({ ...settings, showDiffDateRestore: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-gray-700 dark:text-gray-300">Mostrar opção "Usar DIFF de" (data/hora) na tela de Restaurar</span>
                </label>

                <div>
                  <label className="label">Caminho dos Scripts Pós-Restauração</label>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Pasta com os scripts .sql executados após a restauração (absoluto ou relativo ao app)</p>
                  <input
                    type="text"
                    value={settings.scriptsRestoreBasePath}
                    onChange={(e) => setSettings({ ...settings, scriptsRestoreBasePath: e.target.value })}
                    className="input"
                    placeholder="Scripts_RestoreBase"
                  />
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Gerar backup</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Cria uma cópia do banco de dados do sistema (BenchRestoration.db) na pasta de Backups. Use para garantir um backup manual antes de aplicar alterações importantes.</p>
                <button
                  onClick={handleGenerateBackup}
                  disabled={isGeneratingBackup}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {isGeneratingBackup ? <span className="animate-spin">⏳</span> : <span>📦</span>}
                  Gerar
                </button>
              </div>
            </div>
          )}

          {/* Servers and Instances Section */}
          {activeSection === 'servers' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">🖥️</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Servidores e Instâncias</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Gerencie servidores SQL e destinos de restauração</p>
                </div>
              </div>

              {/* Servers Card */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Servidores</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Lista de servidores SQL cadastrados</p>

                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 max-h-40 overflow-y-auto mb-4">
                  {servers.map(server => (
                    <div key={server.id} className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{server.name}</span>
                        <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400 mt-1">
                          <span>Backup: <span className="text-primary-600 dark:text-primary-400">{server.backupPath || 'Não definido'}</span></span>
                          <span>Restauração: <span className="text-primary-600 dark:text-primary-400">{server.restorePath || 'Não definido'}</span></span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleEditServer(server)} className="text-blue-500 hover:text-blue-700 text-sm">✎</button>
                        <button onClick={() => handleRemoveServer(server.id)} className="text-red-500 hover:text-red-700 text-sm">✕</button>
                      </div>
                    </div>
                  ))}
                  {servers.length === 0 && <p className="text-sm text-gray-500 p-3">Nenhum servidor cadastrado</p>}
                </div>

                {/* Add/Edit Server Form */}
                <div className="grid grid-cols-4 gap-2">
                  <input
                    type="text"
                    value={newServerName}
                    onChange={(e) => setNewServerName(e.target.value)}
                    placeholder="Servidor"
                    className="input"
                  />
                  <input
                    type="text"
                    value={newServerBackupPath}
                    onChange={(e) => setNewServerBackupPath(e.target.value)}
                    placeholder="Caminho pasta do Backup"
                    className="input"
                  />
                  <input
                    type="text"
                    value={newServerRestorePath}
                    onChange={(e) => setNewServerRestorePath(e.target.value)}
                    placeholder="Caminho pasta Restauração"
                    className="input"
                  />
                  {editingServer ? (
                    <>
                      <button onClick={handleSaveServerEdit} className="btn-success">Salvar</button>
                      <button onClick={handleCancelServerEdit} className="btn-danger">Cancelar</button>
                    </>
                  ) : (
                    <button onClick={handleAddServer} className="btn-primary">+ Adicionar Servidor</button>
                  )}
                </div>
              </div>

              {/* Instances Card */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Instâncias</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Gerenciar instâncias do servidor selecionado</p>

                <div className="mb-4">
                  <label className="label">Selecionar Servidor</label>
                  <select
                    value={selectedServerId || ''}
                    onChange={(e) => setSelectedServerId(Number(e.target.value) || null)}
                    className="input"
                  >
                    <option value="">Selecione um servidor</option>
                    {servers.map(server => (
                      <option key={server.id} value={server.id}>{server.name}</option>
                    ))}
                  </select>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 max-h-40 overflow-y-auto mb-4">
                  {instances.map(instance => (
                    <div key={instance.id} className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <div>
                        <span className="text-sm text-gray-900 dark:text-white">{instance.displayName || instance.name}</span>
                        {instance.azureReleaseDefinitionId > 0 && (
                          <span className="text-xs text-primary-600 dark:text-primary-400 ml-2">Pipeline: {instance.azureReleaseDefinitionId}</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleEditInstance(instance)} className="text-blue-500 hover:text-blue-700 text-sm" title="Editar">✎</button>
                        <button onClick={() => handleRemoveInstance(instance.id)} className="text-red-500 hover:text-red-700 text-sm">✕</button>
                      </div>
                    </div>
                  ))}
                  {instances.length === 0 && <p className="text-sm text-gray-500 p-3">Nenhuma instância cadastrada</p>}
                </div>

                {/* Edit Instance Form */}
                {editingInstance && (
                  <div className="border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Editar Instância</h4>
                      <button onClick={handleCancelInstanceEdit} className="text-gray-500 hover:text-gray-700 text-sm">Cancelar</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={editInstanceName}
                        onChange={(e) => setEditInstanceName(e.target.value)}
                        placeholder="Instância"
                        className="input"
                      />
                      <input
                        type="text"
                        value={editInstanceDisplayName}
                        onChange={(e) => setEditInstanceDisplayName(e.target.value)}
                        placeholder="Nome de Exibição"
                        className="input"
                      />
                      <input
                        type="text"
                        value={editInstanceUsername}
                        onChange={(e) => setEditInstanceUsername(e.target.value)}
                        placeholder="Usuário"
                        className="input"
                      />
                      <input
                        type="password"
                        value={editInstancePassword}
                        onChange={(e) => setEditInstancePassword(e.target.value)}
                        placeholder="Senha (deixar vazio p/ manter)"
                        className="input"
                      />
                      <input
                        type="text"
                        value={editInstanceRestorePath}
                        onChange={(e) => setEditInstanceRestorePath(e.target.value)}
                        placeholder="Pasta de Restauração"
                        className="input"
                      />
                      <input
                        type="text"
                        value={editInstancePipelineId}
                        onChange={(e) => setEditInstancePipelineId(e.target.value)}
                        placeholder="ID Pipeline"
                        className="input"
                      />
                    </div>
                    <button onClick={handleSaveInstanceEdit} className="btn-success mt-3 mr-2">Salvar</button>
                    <button onClick={handleCancelInstanceEdit} className="btn-danger mt-3">Cancelar</button>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input
                    type="text"
                    value={newInstanceName}
                    onChange={(e) => setNewInstanceName(e.target.value)}
                    placeholder="Instância"
                    className="input"
                  />
                  <input
                    type="text"
                    value={newInstancePipelineId}
                    onChange={(e) => setNewInstancePipelineId(e.target.value)}
                    placeholder="ID Pipeline (opcional)"
                    className="input"
                  />
                </div>
                <button onClick={handleAddInstance} disabled={!selectedServerId || !newInstanceName} className="btn-primary disabled:opacity-50">+ Adicionar</button>
              </div>
            </div>
          )}

          {/* Backup Section */}
          {activeSection === 'backup' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-yellow-100 dark:bg-yellow-900 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">📂</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Caminhos de Backup</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Pastas compartilhadas onde ficam os backups</p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">Caminhos Cadastrados</h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Total: {backupSources.length} caminho(s)</p>
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  {backupSources.map((source: any) => (
                    <div key={source.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400">📂</span>
                        <span className="text-sm text-gray-900 dark:text-white font-mono">{source.sharePath}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        <span className="text-xs text-green-500">Ativo</span>
                        <button onClick={() => handleRemoveBackupSource(source.id)} className="text-red-500 hover:text-red-700">✕</button>
                      </div>
                    </div>
                  ))}
                  {backupSources.length === 0 && <p className="text-sm text-gray-500 text-center py-4">Nenhuma fonte configurada</p>}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newBackupSource}
                    onChange={(e) => setNewBackupSource(e.target.value)}
                    placeholder="\\servidor\pasta\backups"
                    className="input flex-1 font-mono text-sm"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddBackupSource()}
                  />
                  <button onClick={handleAddBackupSource} className="btn-primary">+ Adicionar Caminho</button>
                </div>
              </div>
            </div>
          )}

          {/* Azure DevOps Section */}
          {activeSection === 'azure' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">☁️</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Azure DevOps</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Configuração da integração de pipelines</p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Configuração da Conexão</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Credenciais e endpoints do Azure DevOps</p>

                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="label">Token de Acesso</label>
                    <input type="password" value={settings.azureDevOpsToken || ''} onChange={(e) => setSettings({ ...settings, azureDevOpsToken: e.target.value })} className="input" />
                    <p className="text-xs text-green-500 mt-1">● Token válido</p>
                  </div>
                  <div>
                    <label className="label">URL da API (Release)</label>
                    <input type="text" value={settings.azureDevOpsUrl || ''} onChange={(e) => setSettings({ ...settings, azureDevOpsUrl: e.target.value })} className="input" placeholder="https://dev.azure.com/..." />
                    <p className="text-xs text-green-500 mt-1">● Conexão OK</p>
                  </div>
                  <div>
                    <label className="label">Definition ID</label>
                    <input type="number" value={settings.azureReleaseDefinitionId || ''} onChange={(e) => setSettings({ ...settings, azureReleaseDefinitionId: parseInt(e.target.value) || 0 })} className="input w-32" />
                    <p className="text-xs text-green-500 mt-1">● ID encontrado</p>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className="flex gap-2">
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                    <span className="text-xs text-gray-500">Token válido</span>
                    <span className="w-2 h-2 bg-green-500 rounded-full ml-4"></span>
                    <span className="text-xs text-gray-500">Pipeline encontrado</span>
                    <span className="w-2 h-2 bg-green-500 rounded-full ml-4"></span>
                    <span className="text-xs text-gray-500">Conexão OK</span>
                  </div>
                  <button onClick={handleTestAzureConnection} disabled={azureConnectionStatus === 'testing'} className="btn-primary">
                    {azureConnectionStatus === 'testing' ? 'Testando...' : 'Testar Conexão'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Notifications Section */}
          {activeSection === 'notifications' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">🔔</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Notificações</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Configuração da API de notificação</p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <label className="label">URL da API</label>
                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <input type="text" value={settings.notificationApiUrl || ''} onChange={(e) => setSettings({ ...settings, notificationApiUrl: e.target.value })} className="input" placeholder="https://api.example.com/notify" />
                    <p className={`text-xs mt-1 ${notificationConnectionStatus === 'success' ? 'text-green-500' : notificationConnectionStatus === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
                      {notificationConnectionStatus === 'success' ? '● API Online' : notificationConnectionStatus === 'error' ? '● Erro de conexão' : '● Não testado'}
                    </p>
                  </div>
                  <button onClick={handleTestNotificationConnection} disabled={notificationConnectionStatus === 'testing'} className="btn-primary">
                    {notificationConnectionStatus === 'testing' ? 'Testando...' : 'Testar API'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Credentials Section */}
          {activeSection === 'credentials' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">🔑</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Credenciais</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Acessos e autenticações do sistema</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* SQL Credentials */}
                <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Credenciais SQL</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Credenciais padrão para conexão</p>

                  <div className="space-y-4">
                    <div>
                      <label className="label">Usuário</label>
                      <input type="text" value={settings.sqlUsername || ''} onChange={(e) => setSettings({ ...settings, sqlUsername: e.target.value })} className="input" />
                    </div>
                    <div>
                      <label className="label">Senha</label>
                      <div className="relative">
                        <input
                          type={showSqlPassword ? 'text' : 'password'}
                          value={settings.sqlPassword || ''}
                          onChange={(e) => setSettings({ ...settings, sqlPassword: e.target.value })}
                          className="input pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSqlPassword(v => !v)}
                          className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                          title={showSqlPassword ? 'Ocultar senha' : 'Mostrar senha'}
                        >
                          {showSqlPassword ? '🙈' : '👁'}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className={`text-xs ${sqlConnectionStatus === 'success' ? 'text-green-500' : sqlConnectionStatus === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
                        {sqlConnectionStatus === 'success' ? '● Conectado' : sqlConnectionStatus === 'error' ? '● Erro de conexão' : '● Não testado'}
                      </p>
                      <button onClick={handleTestSqlConnection} disabled={sqlConnectionStatus === 'testing'} className="btn-primary text-sm">
                        {sqlConnectionStatus === 'testing' ? 'Testando...' : 'Testar Conexão'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Network Credentials */}
                <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Credenciais de Rede</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Usuário e senha para pastas compartilhadas</p>

                  <div className="space-y-4">
                    <div>
                      <label className="label">Usuário (DOMÍNIO\user)</label>
                      <input type="text" value={settings.networkUsername || ''} onChange={(e) => setSettings({ ...settings, networkUsername: e.target.value })} className="input" />
                    </div>
                    <div>
                      <label className="label">Senha</label>
                      <div className="relative">
                        <input
                          type={showNetworkPassword ? 'text' : 'password'}
                          value={settings.networkPassword || ''}
                          onChange={(e) => setSettings({ ...settings, networkPassword: e.target.value })}
                          className="input pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNetworkPassword(v => !v)}
                          className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                          title={showNetworkPassword ? 'Ocultar senha' : 'Mostrar senha'}
                        >
                          {showNetworkPassword ? '🙈' : '👁'}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className={`text-xs ${networkConnectionStatus === 'success' ? 'text-green-500' : networkConnectionStatus === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
                        {networkConnectionStatus === 'success' ? '● Conectado' : networkConnectionStatus === 'error' ? '● Erro de conexão' : '● Não testado'}
                      </p>
                      <button onClick={handleTestNetworkConnection} disabled={networkConnectionStatus === 'testing'} className="btn-primary text-sm">
                        {networkConnectionStatus === 'testing' ? 'Testando...' : 'Testar Conexão'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Security Section */}
          {activeSection === 'security' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">🛡️</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Segurança</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Políticas e permissões do sistema</p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Configurações de Segurança</h3>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.hideSelectAllInDelete}
                    onChange={(e) => setSettings({ ...settings, hideSelectAllInDelete: e.target.checked })}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-gray-700 dark:text-gray-300">Ocultar selecionar Todos os bancos na tela de Exclusão</span>
                </label>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Regras de Proteção</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Defina regras para impedir a exclusão ou restauração de bancos específicos em determinados servidores e instâncias.</p>

                <div className="grid grid-cols-6 gap-2 mb-4">
                  <select
                    value={securityRuleServer?.id || ''}
                    onChange={(e) => {
                      const server = servers.find(s => s.id === Number(e.target.value))
                      setSecurityRuleServer(server || null)
                      setSecurityRuleInstance(null)
                    }}
                    className="input text-sm"
                  >
                    <option value="">Servidor</option>
                    {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <select
                    value={securityRuleInstance?.id || ''}
                    onChange={(e) => {
                      const inst = securityRuleInstances.find(i => i.id === Number(e.target.value))
                      setSecurityRuleInstance(inst || null)
                    }}
                    className="input text-sm"
                    disabled={!securityRuleServer}
                  >
                    <option value="">Instância</option>
                    {securityRuleInstances.map(i => <option key={i.id} value={i.id}>{i.displayName || i.name}</option>)}
                  </select>
                  <input type="text" value={securityRuleDatabase} onChange={(e) => setSecurityRuleDatabase(e.target.value)} placeholder="Banco de Dados" className="input text-sm" />
                  <select value={securityRuleType} onChange={(e) => setSecurityRuleType(e.target.value)} className="input text-sm">
                    <option value="Exclusão">Exclusão</option>
                    <option value="Restauração">Restauração</option>
                    <option value="Exclusão e Restauração">Exclusão e Restauração</option>
                  </select>
                  <button onClick={handleAddSecurityRule} className="btn-primary text-sm">Adicionar</button>
                </div>

                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  {/* Filter by server/instance */}
                  <div className="flex items-center gap-2 flex-wrap px-3 py-3 border-b border-gray-100 dark:border-gray-700">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mr-1">Filtrar:</span>
                    <select
                      value={securityFilterServer}
                      onChange={(e) => {
                        setSecurityFilterServer(e.target.value)
                        setSecurityFilterInstance('')
                      }}
                      className="input text-sm !py-1.5 w-auto"
                    >
                      <option value="">Nenhum servidor</option>
                      <option value="all">Todos os servidores</option>
                      {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <select
                      value={securityFilterInstance}
                      onChange={(e) => setSecurityFilterInstance(e.target.value)}
                      className="input text-sm !py-1.5 w-auto"
                      disabled={securityFilterServer === ''}
                    >
                      <option value="">Nenhuma instância</option>
                      {securityFilterServer === 'all' && <option value="all">Todas as instâncias</option>}
                      {securityFilterServer !== '' && securityFilterServer !== 'all' && securityFilterInstances.map(i => <option key={i.id} value={i.id}>{i.displayName || i.name}</option>)}
                    </select>
                    {securityFilterServer && (
                      <button
                        onClick={() => { setSecurityFilterServer(''); setSecurityFilterInstance('') }}
                        className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 underline"
                      >
                        Limpar filtro
                      </button>
                    )}
                    <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                      {securityFilterServer === '' ? 'Selecione um filtro para exibir' : `Exibindo ${filteredSecurityRules.length} de ${securityRules.length} regra(s)`}
                    </span>
                  </div>

                  {filteredSecurityRules.length === 0 ? (
                    <p className="text-sm text-gray-500 p-4 text-center">
                      {securityFilterServer === ''
                        ? 'Selecione um servidor e instância no filtro acima para visualizar as regras'
                        : 'Nenhuma regra para o filtro selecionado'}
                    </p>
                  ) : (
                    filteredSecurityRules.map((rule: any) => (
                      <div key={rule.id} className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                        <div className="text-sm flex items-center gap-1 flex-wrap">
                          <span className="text-gray-900 dark:text-white">{rule.serverName}</span>
                          <span className="text-gray-400">/</span>
                          <span className="text-gray-600 dark:text-gray-400">{rule.instanceName}</span>
                          <span className="text-gray-400">/</span>
                          <span className="text-gray-900 dark:text-white font-medium">{rule.databaseName}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ml-1 ${
                            rule.ruleType.includes('Exclusão') && rule.ruleType.includes('Restauração')
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                              : rule.ruleType.includes('Exclusão')
                              ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
                              : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                          }`}>{rule.ruleType}</span>
                        </div>
                        <button onClick={() => handleRemoveSecurityRule(rule.id)} className="text-red-500 hover:text-red-700 text-sm ml-2 shrink-0">✕</button>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-start gap-2">
                    <span className="text-lg">ℹ️</span>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white text-sm">Como funciona</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">As regras definem bancos que não podem ser excluídos ou restaurados no servidor e instância selecionados.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Usuários Section */}
          {activeSection === 'usuarios' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">👥</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Usuários</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Gerenciar usuários do sistema</p>
                </div>
              </div>

              {/* Change Password (all users) */}
              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Alterar Senha</h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Senha atual"
                    className="input"
                  />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Nova senha"
                    className="input"
                  />
                </div>
                <button onClick={handleChangePassword} className="btn-primary">Salvar Senha</button>
              </div>

              {/* User Management (admin only) */}
              {isAdmin && (
                <>
                  <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">
                      {editingUser ? 'Editar Usuário' : 'Novo Usuário'}
                    </h3>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <input
                        type="text"
                        value={newUserUsername}
                        onChange={(e) => setNewUserUsername(e.target.value)}
                        placeholder="Nome de usuário"
                        className="input"
                        disabled={!!editingUser}
                      />
                      <input
                        type="password"
                        value={editingUser ? editingUserPassword : newUserPassword}
                        onChange={(e) => {
                          if (editingUser) setEditingUserPassword(e.target.value)
                          else setNewUserPassword(e.target.value)
                        }}
                        placeholder={editingUser ? 'Nova senha (deixe vazio para manter)' : 'Senha'}
                        className="input"
                      />
                      <select
                        value={newUserRole}
                        onChange={(e) => setNewUserRole(e.target.value)}
                        className="input"
                      >
                        <option value="Usuario">Usuário</option>
                        <option value="Administrador">Administrador</option>
                      </select>
                    </div>

                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Permissões
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {allPermissions.map(perm => (
                          <label
                            key={perm.key}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                              newUserPermissions.includes(perm.key)
                                ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={newUserPermissions.includes(perm.key)}
                              onChange={() => handleTogglePermission(perm.key)}
                              className="sr-only"
                            />
                            {perm.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {editingUser ? (
                        <>
                          <button onClick={handleSaveUser} className="btn-primary">Salvar</button>
                          <button onClick={() => { setEditingUser(null); setNewUserUsername(''); setNewUserPassword(''); setNewUserRole('Usuario'); setNewUserPermissions([]); }} className="btn-secondary">Cancelar</button>
                        </>
                      ) : (
                        <button onClick={handleCreateUser} className="btn-primary">+ Criar Usuário</button>
                      )}
                    </div>
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Usuários Cadastrados</h3>
                    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                      {users.length === 0 ? (
                        <p className="text-sm text-gray-500 p-4 text-center">Nenhum usuário cadastrado</p>
                      ) : (
                        users.map((user: any) => (
                          <div key={user.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
                            <div className="flex-1">
                              <div className="flex items-center gap-3">
                                <span className={`w-2 h-2 rounded-full ${user.isActive ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                <span className="font-medium text-gray-900 dark:text-white">{user.username}</span>
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                  user.role === 'Administrador'
                                    ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300'
                                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                                }`}>
                                  {user.role}
                                </span>
                                {!user.isActive && (
                                  <span className="text-xs text-red-500">Inativo</span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {(user.permissions || []).map((p: string) => (
                                  <span key={p} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded">
                                    {allPermissions.find(ap => ap.key === p)?.label || p}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button onClick={() => handleToggleUserActive(user)} className={`text-sm ${user.isActive ? 'text-yellow-500 hover:text-yellow-700' : 'text-green-500 hover:text-green-700'}`}>
                                {user.isActive ? '🔴' : '🟢'}
                              </button>
                              <button onClick={() => handleEditUser(user)} className="text-blue-500 hover:text-blue-700 text-sm">✎</button>
                              <button onClick={() => handleDeleteUser(user.id)} className="text-red-500 hover:text-red-700 text-sm">✕</button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Post-Restore Scripts Section */}
          {activeSection === 'scripts' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-teal-100 dark:bg-teal-900 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">📜</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Scripts Pós-Restauração</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Scripts SQL executados após a restauração de bancos específicos</p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Scripts Cadastrados</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Total: {Array.isArray(postRestoreScripts) ? postRestoreScripts.length : 0} script(s)</p>

                <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 max-h-60 overflow-y-auto mb-4">
                  {Array.isArray(postRestoreScripts) && postRestoreScripts.map((script: any) => (
                    <div key={script.id} className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{script.databaseName}</span>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">{script.scriptPath}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">Ordem: {script.sortOrder}</span>
                        <button onClick={() => handleRemoveScript(script.id)} className="text-red-500 hover:text-red-700 text-sm">✕</button>
                      </div>
                    </div>
                  ))}
                  {(!Array.isArray(postRestoreScripts) || postRestoreScripts.length === 0) && (
                    <p className="text-sm text-gray-500 p-4 text-center">Nenhum script cadastrado</p>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  <input
                    type="text"
                    value={scriptDatabaseName}
                    onChange={(e) => setScriptDatabaseName(e.target.value)}
                    placeholder="Nome do Banco"
                    className="input text-sm"
                  />
                  <input
                    type="text"
                    value={scriptPath}
                    onChange={(e) => setScriptPath(e.target.value)}
                    placeholder="Caminho do Script (.sql)"
                    className="input text-sm font-mono"
                  />
                  <input
                    type="number"
                    value={scriptSortOrder}
                    onChange={(e) => setScriptSortOrder(parseInt(e.target.value) || 0)}
                    placeholder="Ordem"
                    className="input text-sm w-20"
                  />
                  <button onClick={handleAddScript} className="btn-primary text-sm">+ Adicionar</button>
                </div>

                <div className="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-start gap-2">
                    <span className="text-lg">ℹ️</span>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-white text-sm">Como funciona</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Os scripts são executados via sqlcmd.exe após a restauração do banco de dados correspondente.
                        Use o nome do banco para associar o script. A ordem determina a sequência de execução.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Import/Export Section */}
          {activeSection === 'importexport' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">📦</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Importar/Exportar</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Backup e restauração das configurações do sistema</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Export */}
                <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Exportar Configurações</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Salvar configurações atuais em arquivo JSON</p>

                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 mb-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Selecione o que deseja exportar:</p>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={exportGeneral} onChange={(e) => setExportGeneral(e.target.checked)} className="w-4 h-4 rounded" /><span className="text-sm">Configurações Gerais</span></label>
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={exportCredentials} onChange={(e) => setExportCredentials(e.target.checked)} className="w-4 h-4 rounded" /><span className="text-sm">Credenciais SQL e de Rede</span></label>
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={exportAzureDevOps} onChange={(e) => setExportAzureDevOps(e.target.checked)} className="w-4 h-4 rounded" /><span className="text-sm">Configurações Azure DevOps</span></label>
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={exportServers} onChange={(e) => setExportServers(e.target.checked)} className="w-4 h-4 rounded" /><span className="text-sm">Servidores e Instâncias</span></label>
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={exportBackupPaths} onChange={(e) => setExportBackupPaths(e.target.checked)} className="w-4 h-4 rounded" /><span className="text-sm">Caminhos de Backup</span></label>
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={exportNotifications} onChange={(e) => setExportNotifications(e.target.checked)} className="w-4 h-4 rounded" /><span className="text-sm">Notificações</span></label>
                      <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={exportSecurity} onChange={(e) => setExportSecurity(e.target.checked)} className="w-4 h-4 rounded" /><span className="text-sm">Segurança</span></label>
                    </div>
                  </div>

                  <button onClick={handleExport} className="btn-primary w-full">📤 Exportar Selecionados</button>
                </div>

                {/* Import */}
                <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Importar Configurações</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Restaurar configurações de um arquivo JSON</p>

                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 mb-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Ao importar:</p>
                    <div className="space-y-1">
                      <p className="text-sm text-gray-700 dark:text-gray-300">• Configurações serão substituídas</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300">• Servidores serão adicionados</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300">• Caminhos serão adicionados</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300">• Uma confirmação será exibida</p>
                    </div>
                  </div>

                  <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportFile} className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()} className="btn-primary w-full">📥 Importar Configurações</button>

                  {importPreview && (
                    <div className="mt-4 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                      <h4 className="font-medium text-gray-900 dark:text-white mb-2">Pré-visualização</h4>
                      <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                        <p>Data: {new Date(importPreview.exportDate).toLocaleString('pt-BR')}</p>
                        <p>Servidores: {importPreview.servers?.length || 0}</p>
                        <p>Instâncias: {importPreview.instances?.length || 0}</p>
                        <p>Fontes de Backup: {importPreview.backupSources?.length || 0}</p>
                      </div>
                      <div className="flex gap-3 mt-4">
                        <button onClick={handleApplyImport} className="btn-primary">Aplicar Importação</button>
                        <button onClick={() => setImportPreview(null)} className="btn-secondary">Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* About Section */}
          {activeSection === 'about' && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-xl flex items-center justify-center">
                  <span className="text-2xl">ℹ️</span>
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white">Sobre</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Informações do sistema</p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
                <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Bench Database Operations</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Versão 2.0.0 (Web)</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">© 2026 BenchRestoration</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-green-500 rounded-full"></span>
            <span>Sistema Online</span>
          </div>
          <span>Ambiente: {import.meta.env.DEV ? 'Desenvolvimento' : 'Produção'}</span>
          <span>Última atualização: {new Date().toLocaleDateString('pt-BR')}</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setActiveSection('general')} className="btn-secondary">Cancelar</button>
          <button onClick={handleSaveSettings} className="btn-primary">Salvar Configurações</button>
        </div>
      </div>
      </>
      )}
    </div>
  )
}