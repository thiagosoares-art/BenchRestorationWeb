# Agent.md — Guia para IAs

Este arquivo orienta qualquer IA (Copilot, Cursor, Claude, etc.) a entender, corrigir, melhorar ou criar funcionalidades neste projeto.

---

## O que é este projeto

Sistema web de restauração de bancos de dados SQL Server via Intranet. web port de uma aplicação WPF desktop.

- **Stack:** React 18 + TypeScript + Tailwind CSS | .NET 10 Minimal API + SignalR | SQLite
- **Idioma do código e UI:** Português brasileiro
- **Banco de dados:** SQLite (sem ORM, acesso direto via SqliteConnection)

---

## Arquitetura em 30 segundos

```
Web (React) ──HTTP/WS──► Api (.NET) ──sqlcmd──► SQL Server
                            │
                            ├── SQLite (BenchRestoration.db)
                            ├── SignalR (status em tempo real)
                            └── Azure DevOps API (trigger pipeline)
```

- O **frontend** faz build para `../BenchRestoration.Api/wwwroot/` e é servido pela API em produção
- Em dev, Vite roda na porta 5173 e faz proxy de `/api` e `/hubs` para 5099
- A **API** é um Minimal API (.NET 10) com tudo em `Program.cs` + arquivos de endpoints
- **SignalR** emite status em tempo real para o frontend
- O **Agent** (gRPC) é legado/futuro — não está conectado à API atual

---

## Portas e Ambientes

| Ambiente | Porta | Como iniciar |
|----------|-------|--------------|
| **Produção** | 5263 | Serviço Windows `BenchRestorationApi` |
| **Desenvolvimento** | 5099 | `dotnet run --launch-profile Development` |
| **Vite Dev** | 5173 | `npm run dev` |

---

## Como iniciar em dev

```bash
# Terminal 1: Backend
cd BenchRestorationWeb/src/BenchRestoration.Api
dotnet run --launch-profile Development

# Terminal 2: Frontend
cd BenchRestorationWeb/src/BenchRestoration.Web
npm run dev
```

Acesse: http://localhost:5173 (Vite) ou http://localhost:5099 (direto na API)

---

## COMANDOS ESSENCIAIS DE BUILD

### Build do Frontend
```bash
cd BenchRestorationWeb/src/BenchRestoration.Web
npm run build
```
Saída: `../BenchRestoration.Api/wwwroot/`

### Build do Backend
**ATENÇÃO:** Antes de buildar o backend, MATE o processo que usa a porta:

```powershell
# Matar processo na porta 5099
$conns = Get-NetTCPConnection -LocalPort 5099 -State Listen -ErrorAction SilentlyContinue
if ($conns) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) { Stop-Process -Id $p -Force }
}

# Build
cd BenchRestorationWeb/src/BenchRestoration.Api
dotnet build --nologo --disable-build-servers
```

**NUNCA use `-q` no build** — o SDK .NET 10 tem bug com `-q`. Use `--nologo --disable-build-servers`.

### Reiniciar dev
```powershell
Start-Process -FilePath "dotnet" -ArgumentList "run --no-build --launch-profile Development" `
  -WorkingDirectory "D:\BenchRestorationWeb\BenchRestorationWeb\src\BenchRestoration.Api" `
  -WindowStyle Hidden
```

### Verificar se dev está rodando
```powershell
$r = Invoke-WebRequest -Uri "http://localhost:5099/api/history/?limit=1" -UseBasicParsing -TimeoutSec 10
$r.StatusCode  # Deve ser 200
```

---

## Estrutura de Arquivos Chave

### Backend (`BenchRestoration.Api`)

| Arquivo | O que faz |
|---------|-----------|
| `Program.cs` | Entry point, DI, middleware, rotas, CORS |
| `Data/AppDbContext.cs` | **Toda** a lógica SQLite (~1100 linhas). CRUD, migrações, queries |
| `Endpoints/RestoreEndpoints.cs` | Restore workflow completo (~900 linhas). O arquivo MAIS importante |
| `Endpoints/SettingsEndpoints.cs` | Configurações + export/import |
| `Endpoints/HistoryEndpoints.cs` | Histórico + refresh Azure status |
| `Endpoints/AuthEndpoints.cs` | Autenticação + gestão de usuários |
| `Endpoints/TestEndpoints.cs` | Testes de conexão (SQL, rede, Azure, notificação) |
| `Hubs/RestoreHub.cs` | SignalR hub |
| `Security/PasswordEncryption.cs` | DPAPI encrypt/decrypt |
| `Services/DatabaseBackupService.cs` | Backup automático do SQLite |

### Frontend (`BenchRestoration.Web/src`)

| Arquivo | O que faz |
|---------|-----------|
| `pages/RestorePage.tsx` | Página principal de restauração |
| `pages/BatchRestorePage.tsx` | Restauração em lote |
| `pages/HistoryPage.tsx` | Histórico de operações |
| `pages/SettingsPage.tsx` | Configurações (~1800 linhas, 11 seções) |
| `pages/DeletePage.tsx` | Exclusão de bancos |
| `services/api.ts` | Cliente HTTP para todos os endpoints |
| `hooks/useSignalR.ts` | Conexão SignalR |
| `contexts/AuthContext.tsx` | Autenticação |
| `contexts/RestoreContext.tsx` | Estado da restauração + `updateTerminal` |
| `contexts/BatchContext.tsx` | Estado do lote |
| `types/index.ts` | Todas as interfaces TypeScript |

---

## Fluxo Principal: Restauração

```
1. Frontend envia POST /api/restore/start
   { serverName, instanceName, databaseName, backupFilePath, backupFilePaths, ... }

2. Backend:
   a. Valida parâmetros
   b. Copia backup(s) via UNC (usando credenciais de rede)
   c. Se DIFF: busca FULL base → restaura FULL (NORECOVERY) → tenta DIFFs
   d. Se não-DIFF: restaura diretamente
   e. Verifica estado ONLINE (post-check)
   f. Executa scripts pós-restauração
   g. Dispara pipeline Azure DevOps (se habilitado)
   h. Envia notificação HTTP (se habilitado)
   i. Grava RestoreHistory

3. SignalR emite StatusUpdate, CopyProgress, RestoreProgress, RestoreComplete
4. Azure: PollAzureStatusAsync a cada 10s, máx 120 tentativas
```

---

## Fluxo Azure DevOps

### Trigger
```
POST https://vsrm.dev.azure.com/{org}/{project}/_apis/release/releases?api-version=7.1
Authorization: Basic {base64(:{pat})}
Body: { definitionId, variables: { LISTABASES: { value: "DB1 DB2" } } }
```

### Polling
- A cada 10 segundos, GET na mesma URL
- Lê `environments[0].status`
- Mapeia para português: `queued`→"Na fila", `inprogress`→"Em andamento", `succeeded`→"Sucesso", etc.
- Status terminal: `succeeded`, `partiallysucceeded`, `rejected`, `canceled`
- Máx 120 tentativas (20 min)

### Botão "Status Azure"
- `POST /api/history/refresh-azure-status`
- Busca registros com AzureStatus não-terminal
- Consulta API Azure DevOps para cada releaseId único
- Atualiza DB + emite SignalR

---

## Padrões de Código

### Backend

- **Endpoints:** Arquivos estáticos com métodos de extensão `MapXxxEndpoints(this WebApplication app)`
- **Acesso a dados:** `AppDbContext` (singleton) com métodos públicos que usam `SqliteConnection` direto
- **Senhas:** Criptografadas com DPAPI via `PasswordEncryption.Encrypt/Decrypt`
- **Validação:** FluentValidation em `Validators/`
- **SignalR:** `hubContext.Clients.All.SendAsync("Evento", payload)` — sempre para TODOS os clientes

### Frontend

- **Páginas:** Componentes funcionais com hooks
- **State:** React Query para dados do servidor, useState para estado local
- **Rotas:** React Router v6
- **Estilo:** Tailwind CSS com dark mode (class-based)
- **Terminal:** `appendTerminal(text, color)` para log de operações em tempo real
- **updateTerminal(marker, text, color):** Atualiza última entrada contendo o marker (para status Azure em linha única)

### SQLite

- Sem ORM — SQL direto
- Migrações incrementais controladas por `SchemaVersion`
- `INSERT OR REPLACE` com UNIQUE constraints para idempotência
- Candidatos de backup: `File.Exists` + `RESTORE VERIFYONLY`

---

## Cadeia FULL+DIFF

### Seleção de BACKUPs

1. **Busca automática:** `search-backups` retorna lista com `backupType: "FULL" | "DIFF"`
2. **Frontend filtra:** `dbBackups.filter(b => b.backupType === 'DIFF')` → lista de DIFFs
3. **Exclui `_LOG_`:** Arquivos com `_LOG_` no nome NÃO entram na lista principal (pertencem ao banco de log)
4. **Ordem:** Mais recente → mais antigo

### Restauração

1. FULL base restaurado com `NORECOVERY`
2. DIFFs testados do mais recente ao mais antigo
3. Para cada DIFF:
   - Verificação de integridade (RESTORE VERIFYONLY)
   - Verificação de cadeia LSN (DatabaseBackupLsn do DIFF == FirstLsn do FULL)
   - Tentativa de restauração com RECOVERY
   - Se falha → re-restaura FULL (NORECOVERY) → próximo candidato
4. **Limite: 4 falhas** → finaliza com FULL (RECOVERY)
5. Se nenhum DIFF → finaliza com FULL (RECOVERY)

---

## Erros Comuns e Soluções

### `dotnet build` falha com "file is being used"
→ Mate o processo na porta primeiro (ver comandos acima)

### `npm run build` trava
→ `node_modules` corrompido: `rm -rf node_modules && npm install`

### Frontend não mostra dados novos
→ Verifique se o build do frontend foi feito (`npm run build`) e se os assets estão em `wwwroot/`

### Restore falha com "RESTORE DATABASE está sendo encerrado de forma anormal"
→ DIFF incompatível com o FULL base (LSN mismatch). O sistema tenta o próximo automaticamente.

### Azure status fica "Em andamento" para sempre
→ O polling para após 20 min. Use o botão "Status Azure" no histórico para re-verificar.

### Auth 500 em endpoints protegidos
→ Comportamento esperado quando não autenticado. Faça login primeiro.

---

## Testes Manuais

### Restauração simples
1. Login → Restaurar → Selecionar servidor/instância/banco
2. Clicar "Restaurar" (busca automática FULL+DIFF)
3. Verificar terminal com status em tempo real
4. Verificar histórico após conclusão

### Restauração em lote
1. Restaurar → Lote → Colar nomes de bancos
2. Processar → Verificar terminal e progresso

### Azure Status
1. Histórico → Restauração → Botão "Status Azure"
2. Verificar toast com resultado
3. Verificar badges atualizados na tabela

### Export/Import
1. Configurações → Importar/Exportar → Marcar tudo → Exportar
2. Verificar que `instances` não está vazio
3. Importar o mesmo arquivo → Verificar resumo

---

## Notas Importantes

1. **Produção (5263):** Só após liberação explícita do usuário
2. **AppDbContext é singleton:** Seguro para tasks de polling em background
3. **Dados por usuário:** Servers, BackupSources, Settings são isolados por UserId
4. **UI em português:** Todo o frontend e mensagens de erro são em PT-BR
5. **Backup automático:** SQLite é backupado a cada 12h (máx 48 backups)
