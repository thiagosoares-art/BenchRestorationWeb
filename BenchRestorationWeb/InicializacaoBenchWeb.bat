@echo off
setlocal enableextensions
title Bench Database Operations - Initial Setup
set "SCRIPT_DIR=%~dp0"

echo ============================================
echo  Bench Database Operations - Initial Setup
echo ============================================
echo.
echo This script does a FULL fresh install:
echo   - clones the repository from GitHub
echo   - builds the frontend (React + Vite)
echo   - publishes the .NET API to C:\BenchRestorationWeb
echo   - creates and starts the Windows service
echo   - opens TCP port 5263 in the Windows Firewall
echo.

:: -------------------------------------------------
:: 0. Admin check
:: -------------------------------------------------
net session >nul 2>&1
if errorlevel 1 (
    echo ERROR: This script must be run as Administrator.
    echo Close this window, right-click the .bat file and
    echo choose "Run as administrator", then try again.
    pause
    exit /b 1
)

:: -------------------------------------------------
:: 1. Prerequisites (full list: Requerimentos.txt)
:: -------------------------------------------------
echo 1. Checking prerequisites...

where git >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git was not found on this machine.
    echo Install Git for Windows (2.x or later, x64).
    echo Full requirements: "%SCRIPT_DIR%Requerimentos.txt"
    pause
    exit /b 1
)
for /f "tokens=3" %%a in ('git --version') do set "GIT_VER=%%a"
echo   Git %GIT_VER% (OK)

where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js was not found on this machine.
    echo Install Node.js 18 LTS or later (x64, LTS build).
    echo Full requirements: "%SCRIPT_DIR%Requerimentos.txt"
    pause
    exit /b 1
)
for /f "delims=v" %%a in ('node --version') do set "NODE_VER=%%a"
for /f "tokens=1 delims=." %%a in ("%NODE_VER%") do set "NODE_MAJOR=%%a"
if %NODE_MAJOR% lss 18 (
    echo ERROR: Node.js %NODE_VER% is too old. Node.js 18 or later is required.
    echo Full requirements: "%SCRIPT_DIR%Requerimentos.txt"
    pause
    exit /b 1
)
for /f "delims=" %%a in ('node -p "process.release.lts"') do set "NODE_LTS=%%a"
if "%NODE_LTS%"=="undefined" (
    echo ERROR: Node.js %NODE_VER% is not an LTS release.
    echo Install an LTS build of Node.js 18 or later.
    echo Full requirements: "%SCRIPT_DIR%Requerimentos.txt"
    pause
    exit /b 1
)
echo   Node.js %NODE_VER% (OK)

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm was not found on this machine.
    echo npm is installed together with Node.js.
    echo Full requirements: "%SCRIPT_DIR%Requerimentos.txt"
    pause
    exit /b 1
)
echo   npm (OK)

where dotnet >nul 2>&1
if errorlevel 1 (
    echo ERROR: .NET SDK was not found on this machine.
    echo Install the .NET SDK 10 (LTS), x64 installer.
    echo Full requirements: "%SCRIPT_DIR%Requerimentos.txt"
    pause
    exit /b 1
)
for /f "delims=" %%a in ('dotnet --version') do set "DOTNET_VER=%%a"
echo %DOTNET_VER% | findstr /b /c:"10" >nul
if errorlevel 1 (
    echo ERROR: .NET SDK %DOTNET_VER% found, but this project requires .NET SDK 10.x.
    echo Full requirements: "%SCRIPT_DIR%Requerimentos.txt"
    pause
    exit /b 1
)
echo   .NET SDK %DOTNET_VER% (OK)

set "CURL_AVAILABLE=1"
where curl.exe >nul 2>&1
if errorlevel 1 (
    set "CURL_AVAILABLE=0"
    echo WARNING: curl.exe was not found (it is built into Windows Server 2019).
    echo The API health check at the end will be skipped.
)

:: -------------------------------------------------
:: 2. Fresh install guard
:: -------------------------------------------------
echo 2. Checking that this is a fresh install...
sc query BenchRestorationApi >nul 2>&1
if not errorlevel 1 (
    echo ERROR: The service "BenchRestorationApi" already exists on this machine.
    echo This script is for a FRESH install only and will not touch
    echo an existing installation.
    echo To update, run update-main.bat instead.
    pause
    exit /b 1
)
if exist "C:\BenchWebSource" (
    echo ERROR: C:\BenchWebSource already exists on this machine.
    echo Remove the folder before running this script again.
    pause
    exit /b 1
)
if exist "C:\BenchRestorationWeb\BenchRestoration.Api.exe" (
    echo ERROR: C:\BenchRestorationWeb already contains a published application.
    echo Remove the folder before running this script again.
    pause
    exit /b 1
)

:: -------------------------------------------------
:: 3. Clone repository
:: -------------------------------------------------
echo 3. Cloning the repository from GitHub...
git clone https://github.com/thiagosoares-art/BenchRestorationWeb.git C:\BenchWebSource
if errorlevel 1 (
    echo ERROR: git clone failed.
    echo Check that this machine can reach https://github.com
    echo and that the repository is public.
    pause
    exit /b 1
)
cd /d C:\BenchWebSource\BenchRestorationWeb
if not exist "src\BenchRestoration.Api\BenchRestoration.Api.csproj" (
    echo ERROR: repository layout changed, project files not found.
    pause
    exit /b 1
)

:: -------------------------------------------------
:: 4. Frontend build
:: -------------------------------------------------
echo 4. Building the frontend (React + Vite)...
cd src\BenchRestoration.Web
call npm ci
if errorlevel 1 (
    echo ERROR: "npm ci" failed.
    echo Check that this machine can reach https://registry.npmjs.org
    pause
    exit /b 1
)
call npm run build
if errorlevel 1 (
    echo ERROR: "npm run build" failed. Check the errors above.
    pause
    exit /b 1
)
echo   Frontend built into src\BenchRestoration.Api\wwwroot (OK)
cd /d C:\BenchWebSource\BenchRestorationWeb

:: -------------------------------------------------
:: 5. Publish API
:: -------------------------------------------------
echo 5. Publishing the API to C:\BenchRestorationWeb...
set /a BUILD_ATTEMPT=1

rem NOTA: nao usar "-q" aqui. No SDK .NET 10 o modo quiet dispara um bug
rem no incremental "up-to-date check" que falha o build (MSB3492 /
rem GenerateTargetFrameworkMonikerAttribute) mesmo com obj limpo.
rem --disable-build-servers: evita nodes MSBuild corrompidos que geram
rem .FileListAbsolute.txt / AssemblyInfoInputs.cache vazios em obj.

goto BuildStart

:BuildRetry
set /a BUILD_ATTEMPT += 1
echo   Retry %BUILD_ATTEMPT% of 3...

:BuildStart
call dotnet build src\BenchRestoration.Api\BenchRestoration.Api.csproj -c Release --nologo --disable-build-servers
if errorlevel 1 goto BuildFail

call dotnet publish src\BenchRestoration.Api\BenchRestoration.Api.csproj -c Release -o C:\BenchRestorationWeb --nologo --disable-build-servers
if errorlevel 1 goto PublishFail
goto BuildOk

:BuildFail
echo   Build failed (attempt %BUILD_ATTEMPT%). Cleaning artifacts and retrying...
if %BUILD_ATTEMPT% geq 3 goto FatalFail
call :CleanArtifacts
timeout /t 2 /nobreak >nul
goto BuildRetry

:PublishFail
echo   Publish failed (attempt %BUILD_ATTEMPT%). Cleaning artifacts and retrying...
if %BUILD_ATTEMPT% geq 3 goto FatalFail
call :CleanArtifacts
timeout /t 2 /nobreak >nul
goto BuildRetry

:BuildOk
if not exist "C:\BenchRestorationWeb\BenchRestoration.Api.exe" (
    echo ERROR: publish finished but BenchRestoration.Api.exe was not found
    echo in C:\BenchRestorationWeb.
    pause
    exit /b 1
)

:: -------------------------------------------------
:: 6. Windows service (LocalSystem, auto start)
:: -------------------------------------------------
echo 6. Creating the Windows service...
sc.exe create BenchRestorationApi binPath= "C:\BenchRestorationWeb\BenchRestoration.Api.exe" start= auto displayname= "Bench Database Operations"
if errorlevel 1 (
    echo ERROR: failed to create the Windows service.
    pause
    exit /b 1
)
echo   Service created (runs as LocalSystem, auto start).

:: -------------------------------------------------
:: 7. Firewall (inbound TCP 5263, idempotent)
:: -------------------------------------------------
echo 7. Opening TCP port 5263 in the Windows Firewall...
netsh advfirewall firewall delete rule name="BenchRestorationApi 5263" >nul 2>&1
netsh advfirewall firewall add rule name="BenchRestorationApi 5263" dir=in action=allow protocol=TCP localport=5263
if errorlevel 1 (
    echo WARNING: could not create the firewall rule.
    echo Make sure TCP port 5263 is open for the network.
)

:: -------------------------------------------------
:: 8. Start service
:: -------------------------------------------------
echo 8. Starting the service...
sc.exe start BenchRestorationApi
if errorlevel 1 (
    echo ERROR: failed to start the service.
    echo Check the Windows Event Log and C:\BenchRestorationWeb\Logs.
    pause
    exit /b 1
)

:: -------------------------------------------------
:: 9. Wait for the API (health check, ~60s)
:: -------------------------------------------------
echo 9. Waiting for the API to come online...
if "%CURL_AVAILABLE%"=="0" goto Summary
set /a HEALTH_TRIES=0

:HealthPoll
set /a HEALTH_TRIES += 1
set "HTTP_CODE=000"
for /f "delims=" %%c in ('curl.exe -s -o nul -w "%%{http_code}" http://localhost:5263/health') do set "HTTP_CODE=%%c"
if "%HTTP_CODE%"=="200" goto HealthOk
if %HEALTH_TRIES% geq 12 goto HealthTimeout
echo   Not responding yet (attempt %HEALTH_TRIES% of 12, code %HTTP_CODE%)...
timeout /t 5 /nobreak >nul
goto HealthPoll

:HealthTimeout
echo WARNING: the API did not answer http://localhost:5263/health within ~60s.
echo The service may still be starting. Check it with:
echo   sc query BenchRestorationApi
echo and the logs in C:\BenchRestorationWeb\Logs
goto Summary

:HealthOk
echo   API is up and running!

:Summary
:: detect local IP
set "IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do set "IP=%%a"
set "IP=%IP: =%"
if "%IP%"=="" set "IP=localhost"

echo.
echo ============================================
echo  Installation complete!
echo ============================================
echo.
echo  Service:     BenchRestorationApi (LocalSystem, auto start)
echo  Web app:     http://%IP%:5263
echo  Health:      http://%IP%:5263/health
echo  API base:    http://%IP%:5263/api
echo  Database:    C:\BenchRestorationWeb\Data\BenchRestoration.db (auto-created)
echo  Logs:        C:\BenchRestorationWeb\Logs\api-*.log
echo  Source:      C:\BenchWebSource
echo.
echo  To update the installation later, run:
echo    C:\BenchWebSource\BenchRestorationWeb\update-main.bat
echo.
echo ============================================
pause
exit /b 0

:FatalFail
echo Build/publish FAILED after 3 attempts.
pause
exit /b 1

:CleanArtifacts
dotnet build-server shutdown >nul 2>&1
if exist "src\BenchRestoration.Shared\obj" rmdir /s /q "src\BenchRestoration.Shared\obj"
if exist "src\BenchRestoration.Shared\bin" rmdir /s /q "src\BenchRestoration.Shared\bin"
if exist "src\BenchRestoration.Api\obj" rmdir /s /q "src\BenchRestoration.Api\obj"
if exist "src\BenchRestoration.Api\bin" rmdir /s /q "src\BenchRestoration.Api\bin"
timeout /t 2 /nobreak >nul
exit /b 0
