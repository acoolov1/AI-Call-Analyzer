@echo off
title Check Server Status
echo ========================================
echo   AI Call Analysis - Server Status
echo ========================================
echo.

echo Checking Backend (Port 3000)...
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo [OK] Backend is running on port 3000
    curl -s http://localhost:3000/health >nul 2>&1
    if %errorlevel% equ 0 (
        echo [OK] Backend health check passed
    ) else (
        echo [WARNING] Port 3000 is occupied but not responding to health check
        echo           This might be the wrong application!
    )
) else (
    echo [ERROR] No process listening on port 3000
)
echo.

echo Checking Frontend (Port 3001)...
netstat -ano | findstr ":3001" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo [OK] Frontend is running on port 3001
) else (
    echo [ERROR] No process listening on port 3001
)
echo.

echo ========================================
echo   Quick Test Commands:
echo ========================================
echo.
echo Test backend:  curl http://localhost:3000/health
echo Open frontend: start http://localhost:3001
echo.
pause

