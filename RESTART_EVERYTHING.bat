@echo off
echo ========================================
echo Restarting Everything in Correct Order
echo ========================================
echo.

echo Step 1: Stopping all Node.js processes...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Step 2: Verifying ports are free...
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo WARNING: Port 3000 is still in use!
) else (
    echo Port 3000 is free.
)

netstat -ano | findstr ":3001" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo WARNING: Port 3001 is still in use!
) else (
    echo Port 3001 is free.
)

echo.
echo ========================================
echo Now start servers in this order:
echo ========================================
echo.
echo TERMINAL 1 - Backend (Port 3000):
echo   cd backend
echo   npm run dev
echo.
echo Wait for: "Server started on port 3000"
echo.
echo TERMINAL 2 - Frontend (Port 3001):
echo   cd frontend
echo   npm run dev
echo.
echo Wait for: "Ready on http://localhost:3001"
echo.
echo ========================================
echo.
pause

