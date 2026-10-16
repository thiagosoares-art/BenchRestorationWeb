export interface Server {
  id: number
  name: string
  description?: string
  backupPath?: string
  restorePath?: string
}

export interface Instance {
  id: number
  serverId: number
  name: string
  displayName?: string
  authType: string
  username?: string
  passwordEnc?: string
  restorePath?: string
  azureReleaseDefinitionId: number
}

export interface Database {
  id: number
  name: string
  backupFilePath?: string
  sizeKB: number
  lastBackupDate?: string
  backupType?: string
  isSelected: boolean
  isDifferential: boolean
}

export interface BackupSource {
  id: number
  sharePath: string
  description?: string
  isActive: boolean
}

export interface RestoreHistory {
  id: number
  serverName: string
  instanceName: string
  databaseName: string
  backupFile?: string
  restorePath?: string
  status: 'EmAndamento' | 'Sucesso' | 'Erro' | 'Cancelado'
  startedAt?: string
  finishedAt?: string
  duration?: string
  errorMessage?: string
  triggeredAzure: boolean
  azureReleaseId?: string
  azureStatus?: string
  postCheck?: string
  userId?: number
  userName?: string
}

export interface DeleteHistory {
  id: number
  serverName: string
  instanceName: string
  databaseName: string
  status: 'Excluido' | 'Bloqueado' | 'Erro'
  message?: string
  deletedAt?: string
  userId?: number
  userName?: string
}

export interface AppSettings {
  backupDestination?: string
  defaultRestoreBasePath?: string
  azureDevOpsToken?: string
  azureDevOpsUrl?: string
  azureReleaseDefinitionId: number
  notificationApiUrl?: string
  sqlUsername?: string
  sqlPassword?: string
  networkUsername?: string
  networkPassword?: string
  defaultIncludeLogDatabase: boolean
  showDiffDateRestore: boolean
  scriptsRestoreBasePath?: string
  hideSelectAllInDelete: boolean
  deleteExceptionDatabases?: string
  restoreExceptionDatabases?: string
  theme?: string
}

export interface ConfigExport {
  version: string
  exportDate: string
  settings: Record<string, string | null>
  servers: Server[]
  instances: Instance[]
  backupSources: BackupSource[]
}

// Raw format from desktop export (PascalCase) or web export (camelCase)
export interface ConfigExportRaw {
  Version?: string
  version?: string
  ExportDate?: string
  exportDate?: string
  Settings?: Record<string, string | null>
  settings?: Record<string, string | null>
  Servers?: Array<{ Id?: number; Name?: string; Description?: string | null; BackupPath?: string | null; RestorePath?: string | null; id?: number; name?: string; description?: string | null; backupPath?: string | null; restorePath?: string | null }>
  servers?: Array<{ Id?: number; Name?: string; Description?: string | null; BackupPath?: string | null; RestorePath?: string | null; id?: number; name?: string; description?: string | null; backupPath?: string | null; restorePath?: string | null }>
  Instances?: Array<{ Id?: number; ServerId?: number; Name?: string; DisplayName?: string; AuthType?: string; Username?: string | null; PasswordEnc?: string | null; RestorePath?: string | null; AzureReleaseDefinitionId?: number; id?: number; serverId?: number; name?: string; displayName?: string; authType?: string; username?: string | null; passwordEnc?: string | null; restorePath?: string | null; azureReleaseDefinitionId?: number }>
  instances?: Array<{ Id?: number; ServerId?: number; Name?: string; DisplayName?: string; AuthType?: string; Username?: string | null; PasswordEnc?: string | null; RestorePath?: string | null; AzureReleaseDefinitionId?: number; id?: number; serverId?: number; name?: string; displayName?: string; authType?: string; username?: string | null; passwordEnc?: string | null; restorePath?: string | null; azureReleaseDefinitionId?: number }>
  BackupSources?: Array<{ Id?: number; SharePath?: string; Description?: string | null; IsActive?: boolean; id?: number; sharePath?: string; description?: string | null; isActive?: boolean }>
  backupSources?: Array<{ Id?: number; SharePath?: string; Description?: string | null; IsActive?: boolean; id?: number; sharePath?: string; description?: string | null; isActive?: boolean }>
}

export interface TerminalEntry {
  text: string
  color: string
}

export interface RestoreRequest {
  serverName: string
  instanceName: string
  databaseName: string
  backupFilePath?: string
  backupFilePaths?: string[]
  restorePath?: string
  sqlUsername?: string
  sqlPassword?: string
  networkUsername?: string
  networkPassword?: string
  verifyIntegrity: boolean
  cleanupAfterRestore: boolean
  triggerAzure: boolean
  sendNotification: boolean
  reuseBackup: boolean
  includeLogDb: boolean
  logBackupFilePath?: string
  restorePathLog?: string
}

export interface BackupSearchResult {
  name: string
  filePath: string
  sizeKB: number
  lastBackupDate: string
  backupType: string
}

export interface BackupSearchResponse {
  backups: BackupSearchResult[]
  logBackups: BackupSearchResult[]
}

export interface DiskInfo {
  name: string
  volumeName: string
  totalSizeBytes: number
  freeSpaceBytes: number
  usedSpaceBytes: number
  fileSystem: string
  driveType: string
  usedPercent: number
  totalSizeGB: number
  freeSpaceGB: number
  usedSpaceGB: number
}

export interface ShareInfo {
  name: string
  path: string
}

export interface QueueItem {
  id: number
  databaseName: string
  serverName: string
  instanceName: string
  backupFilePath: string
  restorePath: string
  status: 'Pending' | 'Running' | 'Completed' | 'Failed'
  requestedBy: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  errorMessage?: string
  sortOrder: number
  reuseBackup: boolean
}

export interface DashboardMetrics {
  totalRestores: number
  successCount: number
  errorCount: number
  successRate: string
  averageDuration: string
  lastRestoreDate?: string
}

export interface BackupStatusItem {
  name: string
  status: string
  color: string
}

export interface TimelineItem {
  time: string
  databaseName: string
  duration: string
  status: string
  statusColor: string
}

export interface DayMetric {
  date: string
  successCount: number
  errorCount: number
}

export interface DbDurationMetric {
  databaseName: string
  averageDuration: string
}

export interface DashboardResponse {
  metrics: DashboardMetrics
  backupStatus: BackupStatusItem[]
  timeline: TimelineItem[]
  dailyActivity?: DayMetric[]
  durationByDatabase?: DbDurationMetric[]
}

export interface SecurityRule {
  id: number
  serverName: string
  instanceName: string
  databaseName: string
  ruleType: string
  createdAt: string
}

export interface PostRestoreScript {
  id: number
  databaseName: string
  scriptPath: string
  sortOrder: number
}

export interface UserInfo {
  id: number
  username: string
  role: string
  permissions: string[]
}

export interface LoginRequest {
  username: string
  password: string
  rememberMe?: boolean
}

export interface LoginResponse {
  success: boolean
  message?: string
  user?: UserInfo
}

export interface CreateUserRequest {
  username: string
  password: string
  role: string
  permissions: string[]
}

export interface UpdateUserRequest {
  password?: string
  role?: string
  isActive?: boolean
  permissions?: string[]
}

export interface User {
  id: number
  username: string
  role: string
  isActive: boolean
  createdAt: string
  permissions: string[]
}
