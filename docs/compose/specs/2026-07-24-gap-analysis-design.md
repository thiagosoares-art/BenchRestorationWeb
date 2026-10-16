# [S1] Problem

BenchRestorationWeb is a web port of the WPF desktop application BenchRestoration. While the core restore and delete workflows are functional, several features from the desktop version are missing or incomplete in the web version.

# [S2] Gap Analysis Summary

| # | Feature | Desktop Status | Web Status | Priority |
|---|---------|---------------|------------|----------|
| 1 | Dashboard Page | Full UI with metrics, backup status, disk usage, timeline | API endpoint exists, NO frontend page | HIGH |
| 2 | Security Rules UI | Full CRUD in Settings with per-database rules | Form exists but NOT wired to API (no onClick, no API calls) | HIGH |
| 3 | Post-Restore Scripts UI | Full CRUD in Settings for script management | Backend CRUD exists, NO frontend page | MEDIUM |
| 4 | Azure DevOps Trigger | Fires release pipeline after successful restore | Flag tracked but NO actual API call made | HIGH |
| 5 | Notification Trigger | Sends HTTP POST after restore | Flag tracked but NO actual API call made | HIGH |
| 6 | Log Database Restore | Restores companion `_LOG` database after main restore | UI checkbox exists, logic NOT implemented | HIGH |
| 7 | RestoreQueue Processing | Background worker processes queue items automatically | Queue CRUD exists, NO background worker | MEDIUM |
| 8 | Exception Databases | Delete/restore blocked for configured exception databases | Settings stored but NOT enforced | MEDIUM |
| 9 | Known DBs from Import | Imports known databases during config import | Only settings/servers/instances imported | LOW |
| 10 | Backup Chain Validation | Validates FULL+DIFF LSN chain compatibility | NOT implemented | MEDIUM |
| 11 | Auto-Queue on Conflict | Auto-adds to queue if another restore is running | NOT implemented | LOW |

# [S3] Solution Overview

Implement all missing features in priority order:

**Phase 1 - Critical Missing Features:**
1. Dashboard Page (frontend)
2. Security Rules UI wiring
3. Azure DevOps + Notification triggers in restore flow
4. Log Database restore logic

**Phase 2 - Important Features:**
5. Post-Restore Scripts management UI
6. Exception database enforcement
7. Backup chain validation
8. RestoreQueue background worker

**Phase 3 - Nice to Have:**
9. Known DBs import
10. Auto-queue on conflict

# [S4] Implementation Details

## [S4.1] Dashboard Page
- Create `DashboardPage.tsx` with metrics cards, backup status table, disk usage bars, and timeline
- Route: `/dashboard`
- Add to navigation in `Layout.tsx`
- Use existing `/api/dashboard/metrics` endpoint

## [S4.2] Security Rules UI
- Wire the existing form in `SettingsPage.tsx` to call API endpoints
- Load rules from `GET /api/security-rules` on mount
- Add onClick handler to "Add" button calling `POST /api/security-rules`
- Add delete button per rule calling `DELETE /api/security-rules/{id}`

## [S4.3] Azure DevOps + Notification Triggers
- In `RestoreEndpoints.cs`, after successful restore:
  - If `triggerAzure` is true, call Azure DevOps REST API to trigger release
  - If `sendNotification` is true, call notification API URL
- Use existing `TestEndpoints.cs` patterns for HTTP calls

## [S4.4] Log Database Restore
- In `RestoreEndpoints.cs`, after main restore:
  - If `includeLogDb` is true, search for `{databaseName}_LOG` backup
  - Execute restore pipeline for the LOG database
  - Include in history recording

## [S4.5] Post-Restore Scripts UI
- Add section in `SettingsPage.tsx` or create dedicated page
- List scripts from `GET /api/post-restore-scripts`
- Add/edit/delete via API

## [S4.6] Exception Database Enforcement
- In `DeleteEndpoints.cs`: check `DeleteExceptionDatabases` setting before dropping
- In `RestoreEndpoints.cs`: check `RestoreExceptionDatabases` setting before restoring

## [S4.7] Backup Chain Validation
- In `RestoreEndpoints.cs`, when processing DIFF backups:
  - Query `RESTORE HEADERONLY` for both FULL and DIFF
  - Verify `DatabaseBackupLsn` matches `FirstLsn`
  - Reject incompatible chains

# [S5] Files to Modify

**Frontend (React):**
- `src/pages/DashboardPage.tsx` (NEW)
- `src/pages/SettingsPage.tsx` (Security Rules wiring, Post-Restore Scripts section)
- `src/App.tsx` (add Dashboard route)
- `src/components/Layout.tsx` (add Dashboard nav item)
- `src/services/api.ts` (add missing API calls)

**Backend (.NET API):**
- `Endpoints/RestoreEndpoints.cs` (Azure trigger, Notification, Log DB, Chain validation)
- `Endpoints/DeleteEndpoints.cs` (Exception enforcement)
- `Data/AppDbContext.cs` (if any new queries needed)
