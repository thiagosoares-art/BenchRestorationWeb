@echo off
setlocal enableextensions
title Bench Database Operations - Update Main
cd /d "%~dp0"

echo ============================================
echo  Updating Main (C:\BenchRestorationWeb)
echo ============================================
echo.

if not exist "src\BenchRestoration.Api\BenchRestoration.Api.csproj" (
    echo ERROR: project not found. Make sure this script is in the repo root.
    pause
    exit /b 1
)

echo 1. Stopping service...
net stop BenchRestorationApi >nul 2>&1
if %errorlevel% neq 0 echo Warning: Could not stop service (may already be stopped)
timeout /t 2 /nobreak >nul

echo 2. Shutting down build servers (release file locks)...
dotnet build-server shutdown >nul 2>&1
timeout /t 1 /nobreak >nul

set /a BUILD_ATTEMPT=1

echo 3. Building...
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

echo 4. Publishing to C:\BenchRestorationWeb...
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
echo 5. Copying Data folder (preserve database)...
if exist "src\BenchRestoration.Api\Data" (
    xcopy /e /y "src\BenchRestoration.Api\Data" "C:\BenchRestorationWeb\Data\" >nul
)

echo 6. Starting service...
net start BenchRestorationApi
if errorlevel 1 (
    echo Failed to start service!
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Update complete!
echo  Service is running on port 5263
echo ============================================
pause >nul
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