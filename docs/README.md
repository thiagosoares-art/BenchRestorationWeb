# BenchRestorationWeb — Documentação do Projeto

## Visão Geral

Sistema de restauração de bancos de dados SQL Server via navegador em Intranet. Web port de uma aplicação WPF desktop, reconstruído com React 18 + .NET 10 Minimal API + SignalR.

**Versão:** 2.0.0  
**Stack:** React 18 + TypeScript + Tailwind CSS | .NET 10 Minimal API + SignalR | SQLite | Windows Auth (AD)

---

## Arquitetura

```
┌──────────────────────┐      ┌──────────────────────┐
│  BenchRestoration.Web│      │  BenchRestoration.Agent│
│  (React 18 + TS)     │      │  (Windows Service +   │
│  Vite dev: 5173      │      │   gRPC server)        │
│                      │      │  Standalone/legado     │
│  Build →             │      └──────────────────────┘
│  ../Api/wwwroot/     │
└──────────┬───────────┘
           │ HTTP/WS (proxy /api + /hubs)
           ▼
┌──────────────────────────────────────────────┐
│         BenchRestoration.Api                  │
│         (.NET 10 Minimal API + SignalR)       │
│                                              │
│  Produção:  http://0.0.0.0:5263              │
│  Desenvolvimento: http://0.0.0.0:5099        │
│  Auth: Cookie-based (BCrypt)                 │
│  Real-time: /hubs/restore (SignalR)          │
│  Banco: SQLite (BenchRestoration.db)         │
│  Background: DatabaseBackupService (12h)     │
│                                              │
│  Referência → BenchRestoration.Shared        │
└──────────────────────┬───────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────┐
│        BenchRestoration.Shared                │
│        (.NET 10 class library)               │
│  11 modelos POCO compartilhados              │
└──────────────────────────────────────────────┘
```

### Relação entre projetos

| Projeto | Tipo | Target | Dependências |
|---------|------|--------|--------------|
| `BenchRestoration.Api` | ASP.NET Core Minimal API | net10.0 | Shared |
| `BenchRestoration.Web` | React 18 + Vite | ES2020 | Nenhum .NET |
| `BenchRestoration.Shared` | Class Library | net10.0 | Nenhuma |
| `BenchRestoration.Agent` | Windows Service + gRPC | net10.0 | Shared |

**Nota:** O Agent é um componente legado/futuro da versão desktop. A API atual faz operações SQL/arquivo diretamente, sem delegar ao Agent.

---

## Estrutura de Diretórios

```
D:\BenchRestorationWeb\
├── docs/                                    # Documentação
│   └── README.md                            # Este arquivo
├── BenchRestorationWeb/                     # Solution root
│   ├── BenchRestoration.slnx                # Solution file
│   ├── README.md                            # Readme da solution
│   └── src/
│       ├── BenchRestoration.Api/            # API Backend
│       │   ├── Data/                        # SQLite access (AppDbContext)
│       │   ├── Endpoints/                   # Rotas da API
│       │   ├── Hubs/                        # SignalR hub
│       │   ├── Security/                    # DPAPI encryption, connection strings
│       │   ├── Services/                    # Background services
│       │   ├── Validators/                  # FluentValidation
│       │   ├── Program.cs                   # Entry point + DI
│       │   └── wwwroot/                     # Build do frontend (produção)
│       ├── BenchRestoration.Web/            # Frontend React
│       │   └── src/
│       │       ├── components/              # Componentes reutilizáveis
│       │       ├── contexts/                # React contexts (Auth, Restore, Batch)
│       │       ├── hooks/                   # useSignalR, useTheme
│       │       ├── pages/                   # Páginas (rotas)
│       │       ├── services/                # API client (api.ts)
│       │       └── types/                   # TypeScript types
│       ├── BenchRestoration.Shared/         # Modelos compartilhados
│       └── BenchRestoration.Agent/          # Windows Service gRPC (legado)
```

---

## Configuração de Ambiente

### Portas

| Ambiente | Porta | Perfil |
|----------|-------|--------|
| **Produção** | 5263 | Serviço Windows `BenchRestorationApi` |
| **Desenvolvimento** | 5099 | `dotnet run --launch-profile Development` |
| **Vite Dev Server** | 5173 | `npm run dev` (proxy para 5099) |

### Pré-requisitos

- .NET 10+ SDK
- Node.js 18+
- SQL Server (instância alvo para restauração)
- Windows (para sqlcmd.exe e operações de rede)

### Iniciar em desenvolvimento

```bash
# Backend (porta 5099)
cd src/BenchRestoration.Api
dotnet run --launch-profile Development

# Frontend (porta 5173, proxy para 5099)
cd src/BenchRestoration.Web
npm run dev
```

### Build para produção

```bash
# Frontend → gera assets em ../BenchRestoration.Api/wwwroot/
cd src/BenchRestoration.Web
npm run build

# Backend → serve os assets via UseStaticFiles()
cd src/BenchRestoration.Api
dotnet build
```

**IMPORTANTE:** Ao fazer build do backend, mate o processo na porta primeiro:
```powershell
# Matar processo na porta 5099
$conns = Get-NetTCPConnection -LocalPort 5099 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) { Stop-Process -Id $p -Force }
}
```

**Evitar `-q` no build:** O SDK .NET 10 tem bug com `-q` no `dotnet build`. Use `--nologo --disable-build-servers` em vez de `-q`.

---

## Banco de Dados (SQLite)

Localização: `{AppDomain.BaseDirectory}/Data/BenchRestoration.db`

### Schema (Migrações 1-5)

| Tabela | Descrição |
|--------|-----------|
| `Servers` | Servidores SQL (Name, BackupPath, RestorePath, UserId). UNIQUE(Name, UserId) |
| `Instances` | Instâncias SQL por servidor (Name, DisplayName, AuthType, Username, PasswordEnc, RestorePath, AzureReleaseDefinitionId). UNIQUE(ServerId, Name) |
| `BackupSources` | Fontes de backup UNC (SharePath, IsActive, UserId). UNIQUE(SharePath, UserId) |
| `RestoreHistory` | Histórico de restaurações (Status, AzureReleaseId, AzureStatus, PostCheck, UserId) |
| `DeleteHistory` | Histórico de exclusões |
| `AppSettings` | Configurações por chave (Key-Value) |
| `UserSettings` | Configurações por usuário (UserId + Key) |
| `Users` | Usuários (Username, PasswordHash, Role, IsActive) |
| `UserPermissions` | Permissões granulares por usuário |
| `SecurityRules` | Regras de bloqueio por servidor/instância/banco |
| `PostRestoreScripts` | Scripts executados pós-restauração |
| `RestoreJobs` | Fila de restauração |
| `KnownDatabases` | Bancos conhecidos (autocomplete) |
| `SchemaVersion` | Controle de versão do schema |

### Status de Restauração

| Valor | Significado |
|-------|-------------|
| `EmAndamento` | Em andamento |
| `Sucesso` | Concluído com sucesso |
| `Erro` | Erro na restauração |
| `Cancelado` | Cancelado pelo usuário |

### Status Azure DevOps

| Valor (português) | Valor (API Azure) |
|-------------------|-------------------|
| `Disparado` | (início, antes do primeiro poll) |
| `Na fila` | `queued` |
| `Em andamento` | `inProgress` |
| `Sucesso` | `succeeded` |
| `Parcial` | `partiallySucceeded` |
| `Rejeitado` | `rejected` |
| `Cancelado` | `canceled` |

---

## API Endpoints

### Autenticação (`/api/auth`)

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/auth/login` | Não | Login (cookie) |
| POST | `/api/auth/logout` | Não | Logout |
| GET | `/api/auth/me` | Não | Usuário atual |
| POST | `/api/auth/change-password` | Sim | Alterar senha |
| GET | `/api/auth/users` | Sim | Listar usuários |
| POST | `/api/auth/users` | Admin | Criar usuário |
| PUT | `/api/auth/users/{id}` | Admin/Self | Atualizar usuário |
| DELETE | `/api/auth/users/{id}` | Admin | Excluir usuário |

### Restauração (`/api/restore`)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/restore/start` | Iniciar restauração (fluxo completo: cópia, verificação, FULL+DIFF chain, RECOVERY, trigger Azure) |
| GET | `/api/restore/search-backups` | Buscar backups por nome de banco |
| POST | `/api/restore/batch-azure-trigger` | Trigger pipeline Azure para múltiplos bancos |

### Servidores e Instâncias (`/api/servers`, `/api/instances`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET/POST/PUT/DELETE | `/api/servers` | CRUD servidores |
| GET/POST/PUT/DELETE | `/api/instances` | CRUD instâncias |
| GET | `/api/instances/by-server/{id}` | Instâncias por servidor |

### Configurações (`/api/settings`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/settings` | Obter configurações (senhas descriptografadas) |
| PUT | `/api/settings` | Salvar configurações (senhas criptografadas) |
| GET | `/api/settings/export` | Exportar todas as configs |
| POST | `/api/settings/import` | Importar configs |

### Histórico (`/api/history`)

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/history` | Listar histórico de restaurações |
| DELETE | `/api/history` | Limpar histórico |
| POST | `/api/history/azure` | Atualizar release Azure no histórico |
| POST | `/api/history/refresh-azure-status` | Re-verificar status Azure para registros pendentes |
| GET/DELETE | `/api/history/delete` | Histórico de exclusões |

### Exclusão (`/api/delete`)

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/delete/list-databases` | Listar bancos no SQL Server |
| POST | `/api/delete/drop-databases` | Excluir bancos selecionados |

### Outros

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/backups/sources` | Fontes de backup |
| POST | `/api/backups/sources` | Adicionar fonte |
| POST | `/api/dashboard/metrics` | Métricas do dashboard |
| POST | `/api/test/sql` | Testar conexão SQL |
| POST | `/api/test/network` | Testar acesso UNC |
| POST | `/api/test/azure` | Testar Azure DevOps |
| GET | `/health` | Health check |

### SignalR Hub

| Evento | Direção | Payload |
|--------|---------|---------|
| `StatusUpdate` | Server→Client | `{ message, color }` |
| `CopyProgress` | Server→Client | `{ percent, copiedMb, totalMb }` |
| `RestoreProgress` | Server→Client | `{ percent, phase, database }` |
| `RestoreComplete` | Server→Client | `{ historyId, success, databaseName }` |
| `AzureStatusUpdate` | Server→Client | `{ historyIds, releaseId, status, rawStatus, color }` |

---

## Frontend — Rotas

| Rota | Página | Descrição |
|------|--------|-----------|
| `/login` | LoginPage | Formulário de autenticação |
| `/` | RestorePage | Restauração principal (seletor servidor/instância/banco, busca de backups, opções) |
| `/batch` | BatchRestorePage | Restauração em lote (colar nomes de bancos, processar sequencialmente) |
| `/history` | HistoryPage | Histórico de restaurações e exclusões |
| `/delete` | DeletePage | Listar e excluir bancos do SQL Server |
| `/queue` | QueuePage | Fila de restauração |
| `/server-size` | ServerSizePage | Uso de disco e shares via WMI |
| `/dashboard` | DashboardPage | Dashboard analítico |
| `/settings` | SettingsPage | Configurações (11 seções) |

### Componentes Reutilizáveis

| Componente | Descrição |
|------------|-----------|
| `Layout.tsx` | Layout principal com header, nav, user info, theme toggle |
| `Card.tsx` | Container de card |
| `Terminal.tsx` | Terminal estilo PowerShell para operações |
| `StatusBadge.tsx` | Badges de status coloridos |
| `ConfirmDialog.tsx` | Modal de confirmação |
| `LoadingSkeleton.tsx` | Placeholder de carregamento |
| `ErrorBoundary.tsx` | Boundary de erros React |
| `ThemeToggle.tsx` | Toggle dark/light |

### Contexts

| Context | Descrição |
|---------|-----------|
| `AuthContext` | Estado de autenticação, login/logout, permissões |
| `RestoreContext` | Estado da restauração (terminal, abort controller) |
| `BatchContext` | Estado do lote (itens, processamento, terminal) |

### Hooks

| Hook | Descrição |
|------|-----------|
| `useSignalR` | Conexão SignalR ao hub `/hubs/restore` |
| `useTheme` | Toggle dark/light, persiste no server |

---

## Fluxo de Restauração

### Restauração Simples (FULL + DIFF)

```
1. Usuário seleciona servidor → instância → banco
2. Clica "Restaurar"
3. Se nenhum backup selecionado → busca automática FULL + DIFF
4. Backend:
   a. Copia backup(s) para o servidor via UNC
   b. Se DIFF detectado → busca FULL base (FindFullBaseForDiffAsync)
   c. Verifica integridade do FULL (RESTORE VERIFYONLY)
   d. Restaura FULL com NORECOVERY
   e. Tenta DIFFs (mais recente → mais antigo)
      - Limite: 4 tentativas de restauração falha
      - Se nenhuma funcionar → finaliza com FULL (RECOVERY)
   f. Post-check: verifica estado ONLINE
   g. Executa scripts pós-restauração
   h. Dispara pipeline Azure (se habilitado)
   i. Envia notificação (se habilitado)
5. SignalR emite status em tempo real
6. Histórico gravado no SQLite
```

### Fluxo Azure DevOps

```
1. Trigger: POST para API Azure DevOps com definitionId + variáveis
2. Polling: a cada 10s, até 120 tentativas (20 min máx)
3. Status mapeado para português
4. Atualiza DB + emite SignalR AzureStatusUpdate
5. Botão "Status Azure" re-verifica registros pendentes
```

### Fluxo de Lote

```
1. Usuário cola nomes de bancos
2. Processa sequencialmente (restore + Azure trigger)
3. Barra de progresso com status Azure
4. Terminal com log completo
```

---

## Segurança

- **Autenticação:** Cookie-based com BCrypt para senhas
- **Autorização:** Roles (Administrador/Usuario) + permissões granulares
- **Criptografia:** DPAPI para senhas no banco (AzureDevOpsToken, SqlPassword, NetworkPassword)
- **Brute-force:** Máx 5 tentativas em 15min → bloqueio de 15min
- **Isolamento:** Dados por usuário (UserId em Servers, BackupSources, Settings)

### Permissões Granulares

| Permissão | Descrição |
|-----------|-----------|
| `restaurar` | Acessar página de restauração |
| `historico` | Acessar histórico |
| `lote` | Acessar restauração em lote |
| `excluir` | Acessar exclusão de bancos |
| `fila` | Acessar fila de restauração |
| `servidor` | Acessar informações de servidor |
| `dashboard` | Acessar dashboard |
| `configuracoes` | Acessar configurações |

---

## Serviços

### DatabaseBackupService

BackgroundService que faz backup do SQLite a cada 12 horas, mantendo máx 48 backups.

### PasswordEncryption

DPAPI-based encrypt/decrypt com entropy `"BenchRestoration_v2.0"` e scope `LocalMachine`.

---

## Observações para Desenvolvedores

### Build do Backend

```powershell
# Matar processo na porta primeiro
$conns = Get-NetTCPConnection -LocalPort 5099 -State Listen -ErrorAction SilentlyContinue
$pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $pids) { Stop-Process -Id $p -Force }

# Build
dotnet build --nologo --disable-build-servers
```

### Build do Frontend

```bash
cd src/BenchRestoration.Web
npm run build
# Saída: ../BenchRestoration.Api/wwwroot/
```

### SQLite — ORM

Não há ORM. Acesso direto via `Microsoft.Data.Sqlite` com `SqliteConnection` e comandos SQL manuais. Migrações controladas por tabela `SchemaVersion`.

### AppDbContext

Classe singleton (~1100 linhas). Contém toda a lógica CRUD do banco. Métodos públicos para cada operação.

### Nomes de arquivos de backup

Padrão: `{Source}_{DatabaseName}_{Type}_{DateTime}.bak`
- Ex: `DATABASE2$PRODUCAO_DIOC_RIBEIRAOPRETO_8228_DIFF_20260819_120624.bak`
- Tipos: `_FULL_`, `_DIFF_`, `_LOG_FULL_`, `_LOG_DIFF_`
- Arquivos `_LOG_` pertencem ao banco de log (`{db}_LOG`) e NÃO devem ser considerados na restauração principal

### Cadeia FULL+DIFF

- FULL base: restaurado com `NORECOVERY`
- DIFFs: testados do mais recente ao mais antigo
- Limite: 4 tentativas de restauração falha → finaliza com FULL
- `FindFullBaseForDiffAsync`: busca FULL mais recente com LastWriteTime <= DIFF
- Verificação LSN: `DatabaseBackupLsn` do DIFF deve bater com `FirstLsn` do FULL

---

## Histórico de Migrações

| # | Mudança |
|---|---------|
| 1 | Tabelas iniciais (Servers, Instances, BackupSources, RestoreHistory, etc.) |
| 2 | `RestoreHistory.UserId` |
| 3 | Tabela `DeleteHistory` |
| 4 | `RestoreHistory.PostCheck` |
| 5 | `RestoreHistory.AzureStatus` |
