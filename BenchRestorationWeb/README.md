# BenchRestoration Web

Sistema de Restauração de Banco de Dados - Versão Web

## Arquitetura

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Backend**: .NET 10 Minimal API + SignalR
- **Agent**: Windows Service com gRPC (legado/futuro; não conectado à API atual)
- **Database**: SQLite
- **Auth**: Autenticação da aplicação

## Pré-requisitos

- .NET 10 SDK
- Node.js 18+
- Git for Windows
- `sqlcmd` (opcional; necessário para operações de backup/restore em SQL Server)

## Estrutura

```
src/
├── BenchRestoration.Web/      # Frontend React
├── BenchRestoration.Api/      # Backend API
├── BenchRestoration.Agent/    # Windows Service Agent
└── BenchRestoration.Shared/   # Models compartilhados
```

## Desenvolvimento

### Frontend
```bash
cd src/BenchRestoration.Web
npm install
npm run dev
```

### Backend
```bash
cd src/BenchRestoration.Api
dotnet run --launch-profile Development
```
> A API de desenvolvimento roda na porta **5099** (`ASPNETCORE_ENVIRONMENT=Development`).
> O Vite dev (5173) faz proxy de `/api` e `/hubs` para essa porta.
> A API de produção roda como Windows Service na porta **5263** e não deve ser usada para testes de desenvolvimento.

### Agent
```bash
cd src/BenchRestoration.Agent
dotnet run
```

## Build

```bash
# Frontend
cd src/BenchRestoration.Web
npm run build

# Backend
dotnet publish -c Release

# Agent
dotnet publish -c Release
```

## Instalação

Consulte `Requerimentos.txt` e execute `InicializacaoBenchWeb.bat` como Administrador
para uma instalação nova em Windows. O script publica a API como serviço Windows;
para atualizar uma instalação existente, use `update-main.bat`.

Na primeira abertura, crie a conta do administrador pela tela inicial. A senha deve
ter pelo menos 12 caracteres. Depois, o administrador pode cadastrar os demais
usuários em Configurações > Usuários. Instalações existentes mantêm suas contas atuais.

## Funcionalidades

- Restauração de bancos SQL Server (FULL, DIFF, LOG)
- Histórico de operações
- Gerenciamento de servidores e instâncias
- Exclusão de bancos
- Integração Azure DevOps
- Notificações
- Tema escuro/claro
- Status em tempo real via SignalR
