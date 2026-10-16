@echo off
title Bench Database Operations Server
cd /d "%~dp0"

:: Kill any previous instance
echo Stopping previous instance...
taskkill /f /im dotnet.exe 2>nul
timeout /t 3 /nobreak >nul

:: Detect local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do set "IP=%%a"
set "IP=%IP: =%"
if "%IP%"=="" set "IP=localhost"

echo ============================================
echo  Bench Database Operations - Server
echo ============================================
echo.
echo Building application...
dotnet build src\BenchRestoration.Api\BenchRestoration.Api.csproj -q
if %errorlevel% neq 0 (
    echo Build failed. Check errors above.
    pause
    exit /b 1
)
echo Starting server...
echo Access from other computers: http://%IP%:5263
echo Access locally: http://localhost:5263
echo.
echo Press Ctrl+C to stop the server.
echo ============================================
dotnet run --project src\BenchRestoration.Api\BenchRestoration.Api.csproj --launch-profile http
pause
