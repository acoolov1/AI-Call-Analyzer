# AI Call Analysis - Safe Startup Script
# This script ensures servers start on the correct ports

$ErrorActionPreference = "SilentlyContinue"

Write-Host "`n========================================"
Write-Host "  AI Call Analysis - Safe Startup" -ForegroundColor Green
Write-Host "========================================`n"

# Step 1: Kill existing Node processes
Write-Host "[1/5] Cleaning up any existing Node processes..." -ForegroundColor Yellow
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    $nodeProcesses | Stop-Process -Force
    Write-Host "      Killed $($nodeProcesses.Count) Node process(es)" -ForegroundColor Cyan
    Start-Sleep -Seconds 3
} else {
    Write-Host "      No existing Node processes found" -ForegroundColor Cyan
}
Write-Host ""

# Step 2: Verify ports are free
Write-Host "[2/5] Verifying ports are free..." -ForegroundColor Yellow

# Check port 3000
$maxRetries = 5
$retryCount = 0
while ($retryCount -lt $maxRetries) {
    $port3000 = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if (-not $port3000) {
        Write-Host "      Port 3000: FREE" -ForegroundColor Green
        break
    } else {
        Write-Host "      Port 3000 still in use, waiting..." -ForegroundColor Red
        Start-Sleep -Seconds 2
        $retryCount++
    }
}

# Check port 3001
$retryCount = 0
while ($retryCount -lt $maxRetries) {
    $port3001 = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if (-not $port3001) {
        Write-Host "      Port 3001: FREE" -ForegroundColor Green
        break
    } else {
        Write-Host "      Port 3001 still in use, waiting..." -ForegroundColor Red
        Start-Sleep -Seconds 2
        $retryCount++
    }
}
Write-Host ""

# Step 3: Start Backend
Write-Host "[3/5] Starting Backend Server (Port 3000)..." -ForegroundColor Yellow
$backendPath = Join-Path $PSScriptRoot "backend"
Start-Process cmd -ArgumentList "/k", "cd /d `"$backendPath`" && title Backend Server - Port 3000 - WITH LOGS && echo. && echo ============================================== && echo   Backend Server Starting with FULL LOGS && echo ============================================== && echo. && npm run dev"
Write-Host "      Backend window opened with FULL LOGGING" -ForegroundColor Cyan
Write-Host ""

# Step 4: Wait for backend to initialize
Write-Host "[4/5] Waiting for backend to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

# Verify backend is running
$backendRunning = $false
for ($i = 0; $i -lt 5; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $backendRunning = $true
            Write-Host "      Backend is HEALTHY" -ForegroundColor Green
            break
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $backendRunning) {
    Write-Host "      WARNING: Backend might not be ready yet" -ForegroundColor Red
}
Write-Host ""

# Step 5: Start Frontend
Write-Host "[5/5] Starting Frontend Server (Port 3001)..." -ForegroundColor Yellow
$frontendPath = Join-Path $PSScriptRoot "frontend"
Start-Process cmd -ArgumentList "/k", "cd /d `"$frontendPath`" && title Frontend Server - Port 3001 - WITH LOGS && echo. && echo ============================================== && echo   Frontend Server Starting with FULL LOGS && echo ============================================== && echo. && npm run dev"
Write-Host "      Frontend window opened with FULL LOGGING" -ForegroundColor Cyan
Write-Host ""

# Success message
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Startup Complete!" -ForegroundColor Green
Write-Host "========================================`n"
Write-Host "Backend:  " -NoNewline
Write-Host "http://localhost:3000/health" -ForegroundColor Cyan
Write-Host "Frontend: " -NoNewline
Write-Host "http://localhost:3001" -ForegroundColor Cyan
Write-Host ""
Write-Host "Two separate terminal windows should be open."
Write-Host "Keep them running while using the app.`n"
Write-Host "Press any key to close this window..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

