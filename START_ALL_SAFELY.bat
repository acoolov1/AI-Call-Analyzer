@echo off
title AI Call Analysis - Smart Startup
color 0A
echo ========================================
echo   AI Call Analysis - Safe Startup
echo ========================================
echo.

echo [1/5] Cleaning up any existing Node processes...
taskkill /F /IM node.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo       Killed existing Node processes
    timeout /t 3 /nobreak >nul
) else (
    echo       No existing Node processes found
)
echo.

echo [2/5] Verifying ports are free...
:CHECK_PORT_3000
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo       WARNING: Port 3000 still in use, retrying...
    timeout /t 2 /nobreak >nul
    goto CHECK_PORT_3000
)
echo       Port 3000: FREE

:CHECK_PORT_3001
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo       WARNING: Port 3001 still in use, retrying...
    timeout /t 2 /nobreak >nul
    goto CHECK_PORT_3001
)
echo       Port 3001: FREE
echo.

echo [3/5] Starting Backend Server (Port 3000)...
start "Backend Server - Port 3000 - WITH LOGS" cmd /k "cd /d %~dp0 && cd backend && echo. && echo ============================================== && echo   Backend Server Starting with FULL LOGS && echo ============================================== && echo. && npm run dev"
echo       Backend window opened with FULL LOGGING
echo.

echo [4/5] Waiting for backend to be ready...
timeout /t 8 /nobreak >nul
echo       Backend should be ready now
echo.

echo [5/5] Starting Frontend Server (Port 3001)...
start "Frontend Server - Port 3001 - WITH LOGS" cmd /k "cd /d %~dp0 && cd frontend && echo. && echo ============================================== && echo   Frontend Server Starting with FULL LOGS && echo ============================================== && echo. && npm run dev"
echo       Frontend window opened with FULL LOGGING
echo.

echo ========================================
echo   Startup Complete!
echo ========================================
echo.
echo Backend:  http://localhost:3000/health
echo Frontend: http://localhost:3001
echo.
echo Two separate terminal windows should be open.
echo Keep them running while using the app.
echo.
echo Press any key to close this window...
pause >nul

