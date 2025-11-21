@echo off
REM Force unbuffered output for real-time logging
title AI Call Analysis - Backend (Real-time Logs)
echo ========================================
echo   Backend Server - Real-time Logging
echo ========================================
echo.
echo Starting with real-time log output...
echo.

cd /d %~dp0

REM Run node directly for unbuffered output
node --watch --trace-warnings src/server.js

pause

