@echo off
title Backend Server - Port 3000 - FULL LOGS
color 0A
echo ================================================
echo   AI Call Analysis - Backend Server
echo   Port 3000 - FULL LOGGING ENABLED
echo ================================================
echo.
echo This window will show ALL backend logs including:
echo   - Server startup messages
echo   - Incoming HTTP requests
echo   - Database queries
echo   - API calls to OpenAI/Twilio
echo   - Errors and warnings
echo   - WebSocket connections
echo   - Background job processing
echo.
echo ================================================
echo   Starting backend server...
echo ================================================
echo.

cd /d "%~dp0backend"

REM Ensure development mode for verbose logging
set NODE_ENV=development

npm run dev

echo.
echo ================================================
echo   Backend server stopped
echo ================================================
echo.
pause

