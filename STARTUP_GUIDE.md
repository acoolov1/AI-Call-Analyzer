# 🚀 AI Call Analysis - Startup Guide

## Problem Solved ✅

After a computer restart, the wrong processes were starting on the wrong ports, causing CORS errors and the app to malfunction.

## Solution

Use the new **safe startup scripts** that automatically:
1. Kill any existing Node processes
2. Verify ports 3000 and 3001 are free
3. Start backend first (and wait for it to be ready)
4. Start frontend second
5. Verify both servers are healthy

---

## 📋 How to Start Your App After Computer Restart

### Option 1: PowerShell (Recommended) ⭐

**Double-click:** `START_ALL_SAFELY.ps1`

Or right-click → "Run with PowerShell"

### Option 2: Batch File

**Double-click:** `START_ALL_SAFELY.bat`

### Option 3: Manual (Original Method)

1. Double-click `START_BACKEND.bat`
2. Wait 5 seconds for backend to start
3. Double-click `START_FRONTEND.bat`

---

## 🔍 Verify Servers Are Running Correctly

**Double-click:** `CHECK_SERVERS.bat`

This will verify:
- ✅ Backend is on port 3000 and responding to health checks
- ✅ Frontend is on port 3001

---

## ⚠️ If You Still Have Issues

### 1. Use the Restart Script

**Double-click:** `RESTART_EVERYTHING.bat`

This kills all Node processes and frees up the ports.

### 2. Then Use Safe Startup

**Double-click:** `START_ALL_SAFELY.ps1` or `START_ALL_SAFELY.bat`

---

## 🎯 What Changed?

### New Files Created:
- ✨ `START_ALL_SAFELY.bat` - Smart startup with error checking and FULL LOGS
- ✨ `START_ALL_SAFELY.ps1` - PowerShell version (more reliable) with FULL LOGS
- ✨ `START_BACKEND_WITH_LOGS.bat` - Start backend only with enhanced logging
- ✨ `CHECK_SERVERS.bat` - Verify servers are running correctly
- ✨ `STARTUP_GUIDE.md` - This guide

### Utility Files:
- `START_BACKEND_WITH_LOGS.bat` - Start backend only (with enhanced logging)
- `RESTART_EVERYTHING.bat` - Kill all Node processes
- `CHECK_SERVERS.bat` - Verify servers are running correctly

---

## 🎉 Benefits of New Scripts

1. **Automatic Port Cleanup** - No more port conflicts
2. **Correct Order** - Backend always starts first
3. **Health Checks** - Verifies backend is ready before starting frontend
4. **Error Detection** - Shows warnings if ports are still occupied
5. **Visual Feedback** - Clear status messages for each step
6. **Full Logging** - Backend and frontend windows show ALL logs including:
   - Server startup messages
   - HTTP requests and responses
   - Database queries
   - API calls (OpenAI, Twilio, FreePBX)
   - Errors and warnings
   - Background job processing

---

## 💡 Pro Tips

### After Every Computer Restart:
- Use `START_ALL_SAFELY.ps1` or `START_ALL_SAFELY.bat`
- Wait for both terminal windows to open
- Check that backend shows "Server started on port 3000"
- Check that frontend shows "Ready on http://localhost:3001"

### If Something Goes Wrong:
1. Run `RESTART_EVERYTHING.bat`
2. Wait 5 seconds
3. Run `START_ALL_SAFELY.ps1`

### Quick Status Check:
- Run `CHECK_SERVERS.bat` anytime to verify everything is working

### Monitor Backend Logs:
- The terminal windows opened by the startup scripts show ALL logs
- Backend logs include: requests, database queries, API calls, errors
- Keep the windows visible to monitor what's happening in real-time

---

## 🌐 Access Your App

Once both servers are running:

- **Frontend (Your App):** http://localhost:3001
- **Backend API:** http://localhost:3000
- **Backend Health:** http://localhost:3000/health

---

## 📝 Technical Details

### Why This Happened
After restarting your computer, if you started the servers too quickly or in the wrong order, the ports could get confused and the wrong application could bind to the wrong port.

### How We Fixed It
The new startup scripts ensure:
1. All old Node processes are killed first
2. Ports are verified to be completely free
3. Backend starts and is healthy before frontend starts
4. Both servers start in separate, visible terminal windows

---

## ✅ Checklist for Success

After running the startup script, you should see:

- [ ] Two terminal windows open (Backend + Frontend)
- [ ] Backend window shows "Server started on port 3000"
- [ ] Frontend window shows "Ready on http://localhost:3001"
- [ ] http://localhost:3001 loads without errors
- [ ] You can log in and see your calls
- [ ] No CORS errors in browser console

---

**Need Help?** Check the main `README.md` for more information or troubleshooting steps.

