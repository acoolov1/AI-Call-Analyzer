@echo off
echo ========================================
echo Starting Backend on Port 3000
echo ========================================
echo.

cd backend

echo Checking if port 3000 is free...
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo ERROR: Port 3000 is still in use!
    echo.
    echo Please stop the process on port 3000 first:
    echo   1. Run STOP_PORT_3000.bat
    echo   2. Or manually stop the process
    echo.
    pause
    exit /b 1
)

echo Port 3000 is free. Starting backend...
echo.

npm run dev

