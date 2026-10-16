import type {
  Server,
  Instance,
  BackupSource,
  RestoreHistory,
  DeleteHistory,
  AppSettings,
  RestoreRequest,
  BackupSearchResult,
  BackupSearchResponse,
  DiskInfo,
  ShareInfo,
  QueueItem,
  DashboardResponse,
  SecurityRule,
  User,
  LoginRequest,
  LoginResponse,
  CreateUserRequest,
  UpdateUserRequest
} from '../types'

const API_BASE = '/api'

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

type ApiResponse<T> = { message?: string } & T

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    let message = `API error: ${response.statusText}`
    try {
      const body = await response.json()
      if (body.message) message = body.message
    } catch { }
    throw new ApiError(response.status, message)
  }

  return response.json()
}

// Servers
export const serversApi = {
  list: () => fetchJson<Server[]>('/servers'),
  create: (server: { name: string; description?: string; backupPath?: string; restorePath?: string }) =>
    fetchJson('/servers', { method: 'POST', body: JSON.stringify(server) }),
  update: (id: number, server: { name: string; description?: string; backupPath?: string; restorePath?: string }) =>
    fetchJson(`/servers/${id}`, { method: 'PUT', body: JSON.stringify(server) }),
  delete: (id: number) => fetchJson(`/servers/${id}`, { method: 'DELETE' }),
}

// Instances
export const instancesApi = {
  listByServer: (serverId: number) => fetchJson<Instance[]>(`/instances/by-server/${serverId}`),
  create: (instance: Instance) =>
    fetchJson('/instances', { method: 'POST', body: JSON.stringify(instance) }),
  update: (id: number, instance: Instance) =>
    fetchJson(`/instances/${id}`, { method: 'PUT', body: JSON.stringify(instance) }),
  delete: (id: number) => fetchJson(`/instances/${id}`, { method: 'DELETE' }),
}

// Backup Sources
export const backupSourcesApi = {
  list: () => fetchJson<BackupSource[]>('/backups/sources'),
  create: (source: { sharePath: string; description?: string }) =>
    fetchJson('/backups/sources', { method: 'POST', body: JSON.stringify(source) }),
  delete: (id: number) => fetchJson(`/backups/sources/${id}`, { method: 'DELETE' }),
  generate: () =>
    fetchJson<{ message: string; backupPath?: string }>('/backups/generate', { method: 'POST' }),
}

// Known Databases
export const databasesApi = {
  listKnown: () => fetchJson<string[]>('/backups/known-databases'),
  addKnown: (name: string) =>
    fetchJson<{ message: string }>('/backups/known-databases', { method: 'POST', body: JSON.stringify({ name }) }),
}

interface SettingsExport {
  version: string
  exportDate: string
  settings: AppSettings
  servers: Server[]
  backupSources: BackupSource[]
}

// Settings
export const settingsApi = {
  get: () => fetchJson<AppSettings>('/settings'),
  update: (settings: Record<string, unknown>) =>
    fetchJson<{ message: string }>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  export: () => fetchJson<SettingsExport>('/settings/export'),
  importConfig: (config: Record<string, unknown>) =>
    fetchJson<{ message: string; errors?: string[] }>('/settings/import', { method: 'POST', body: JSON.stringify(config) }),
}

// History
export const historyApi = {
  list: (limit?: number) => fetchJson<RestoreHistory[]>(`/history?limit=${limit || 100}`),
  clear: () => fetchJson('/history', { method: 'DELETE' }),
  updateAzureStatus: (historyIds: number[], azureReleaseId: string) =>
    fetchJson<{ message: string }>('/history/azure', { method: 'POST', body: JSON.stringify({ historyIds, azureReleaseId }) }),
  refreshAzureStatus: () =>
    fetchJson<{ message: string; checked_: number; updated: number }>('/history/refresh-azure-status', { method: 'POST' }),
  listDeletes: (limit?: number) => fetchJson<DeleteHistory[]>(`/history/delete?limit=${limit || 100}`),
  clearDeletes: () => fetchJson('/history/delete', { method: 'DELETE' }),
}

// Restore
export const restoreApi = {
  start: (request: RestoreRequest, signal?: AbortSignal) =>
    fetchJson('/restore/start', { method: 'POST', body: JSON.stringify(request), signal }),
  searchBackups: (databaseName: string, includeLogDb?: boolean) =>
    fetchJson<BackupSearchResponse>(`/restore/search-backups?databaseName=${encodeURIComponent(databaseName)}&includeLogDb=${!!includeLogDb}`),
  batchAzureTrigger: (request: { instanceName: string; databaseNames: string[]; historyIds: number[] }) =>
    fetchJson<{ success: boolean; message: string; releaseId?: string }>('/restore/batch-azure-trigger', { method: 'POST', body: JSON.stringify(request) }),
}

// Delete
export const deleteApi = {
  listDatabases: (request: { serverName: string; instanceName: string; username?: string; password?: string }) =>
    fetchJson<any[]>('/delete/list-databases', { method: 'POST', body: JSON.stringify(request) }),
  dropDatabases: (request: { serverName: string; instanceName: string; username?: string; password?: string; databaseNames: string[] }) =>
    fetchJson<{ successCount: number; failCount: number; messages: string[] }>('/delete/drop-databases', { method: 'POST', body: JSON.stringify(request) }),
}

// Connection Tests
export const testApi = {
  sqlConnection: (request: { serverName: string; instanceName: string; username?: string; password?: string }) =>
    fetchJson<{ success: boolean; message: string }>('/test/sql', { method: 'POST', body: JSON.stringify(request) }),
  networkConnection: (request: { path: string; username: string; password: string }) =>
    fetchJson<{ success: boolean; message: string }>('/test/network', { method: 'POST', body: JSON.stringify(request) }),
  notificationApi: (url: string) =>
    fetchJson<{ success: boolean; message: string }>(`/test/notification?url=${encodeURIComponent(url)}`),
  azureConnection: (request: { token: string; url: string }) =>
    fetchJson<{ success: boolean; message: string }>('/test/azure', { method: 'POST', body: JSON.stringify(request) }),
}

// Server Size
export const serverSizeApi = {
  getDisks: (request: { serverName: string; username?: string; password?: string }) =>
    fetchJson<DiskInfo[]>('/server-size/disks', { method: 'POST', body: JSON.stringify(request) }),
  getShares: (request: { serverName: string; username?: string; password?: string }) =>
    fetchJson<ShareInfo[]>('/server-size/shares', { method: 'POST', body: JSON.stringify(request) }),
}

// Queue
export const queueApi = {
  getItems: (request: { serverName: string; instanceName: string; sqlUsername?: string; sqlPassword?: string }) =>
    fetchJson<QueueItem[]>('/queue/items', { method: 'POST', body: JSON.stringify(request) }),
  addItem: (request: { serverName: string; instanceName: string; databaseName: string; backupFilePath: string; restorePath: string; sqlUsername?: string; sqlPassword?: string; reuseBackup: boolean }) =>
    fetchJson<{ id: number; message: string }>('/queue/add', { method: 'POST', body: JSON.stringify(request) }),
  removeItem: (request: { serverName: string; instanceName: string; sqlUsername?: string; sqlPassword?: string; jobId: number }) =>
    fetchJson<{ message: string }>('/queue/remove', { method: 'POST', body: JSON.stringify(request) }),
  resetStuck: (request: { serverName: string; instanceName: string; sqlUsername?: string; sqlPassword?: string }) =>
    fetchJson<{ count: number; message: string }>('/queue/reset-stuck', { method: 'POST', body: JSON.stringify(request) }),
}

// Dashboard
export const dashboardApi = {
  getMetrics: (request: { serverName: string; instanceName: string }) =>
    fetchJson<DashboardResponse>('/dashboard/metrics', { method: 'POST', body: JSON.stringify(request) }),
}

// Security Rules
export const securityRulesApi = {
  list: () => fetchJson<SecurityRule[]>('/security-rules'),
  create: (rule: { serverName: string; instanceName: string; databaseName: string; ruleType: string }) =>
    fetchJson('/security-rules', { method: 'POST', body: JSON.stringify(rule) }),
  delete: (id: number) => fetchJson(`/security-rules/${id}`, { method: 'DELETE' }),
  check: (request: { serverName: string; instanceName: string; databaseName: string; operation: 'Exclusão' | 'Restauração' }) =>
    fetchJson<{ hasRule: boolean; ruleType?: string }>('/security-rules/check', { method: 'POST', body: JSON.stringify(request) }),
}

// Post-Restore Scripts
export const postRestoreScriptsApi = {
  list: () => fetchJson('/post-restore-scripts'),
  create: (script: { databaseName: string; scriptPath: string; sortOrder: number }) =>
    fetchJson('/post-restore-scripts', { method: 'POST', body: JSON.stringify(script) }),
  delete: (id: number) => fetchJson(`/post-restore-scripts/${id}`, { method: 'DELETE' }),
}

// Auth
export const authApi = {
  setupStatus: () =>
    fetchJson<{ setupRequired: boolean }>('/auth/setup-status'),
  setup: (request: { username: string; password: string }) =>
    fetchJson<{ success: boolean }>('/auth/setup', { method: 'POST', body: JSON.stringify(request) }),
  login: (request: LoginRequest) =>
    fetchJson<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ username: request.username, password: request.password, rememberMe: request.rememberMe }) }),
  logout: () =>
    fetchJson<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  me: () =>
    fetchJson<LoginResponse>('/auth/me'),
  changePassword: (request: { currentPassword: string; newPassword: string }) =>
    fetchJson<{ success: boolean; message: string }>('/auth/change-password', { method: 'POST', body: JSON.stringify(request) }),
  listUsers: () =>
    fetchJson<User[]>('/auth/users'),
  createUser: (request: CreateUserRequest) =>
    fetchJson('/auth/users', { method: 'POST', body: JSON.stringify(request) }),
  updateUser: (id: number, request: UpdateUserRequest) =>
    fetchJson(`/auth/users/${id}`, { method: 'PUT', body: JSON.stringify(request) }),
  deleteUser: (id: number) =>
    fetchJson(`/auth/users/${id}`, { method: 'DELETE' }),
}
