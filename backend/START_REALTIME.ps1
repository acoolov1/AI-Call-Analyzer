# PowerShell script for real-time backend logging
# Run with: .\START_REALTIME.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Backend Server - Real-time Logging" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Set working directory
Set-Location $PSScriptRoot

# Force unbuffered output
$env:NODE_NO_WARNINGS = "1"

# Run node directly for real-time output
Write-Host "Starting backend with real-time logging..." -ForegroundColor Green
Write-Host ""

node --watch --trace-warnings src/server.js

