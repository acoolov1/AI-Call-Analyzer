# FreePBX Integration Migration Summary

## Overview

The FreePBX integration has been migrated from **ARI (Asterisk REST Interface)** to **SSH + MySQL CDR** for improved reliability and simpler configuration.

**Date:** January 3, 2026  
**Version:** 2.0

---

## What Changed

### Removed

❌ **ARI Connection** - No longer used for any operations  
❌ **ARI Configuration Fields** - Host, Port, Username, Password, TLS, Sync Interval  
❌ **ARI Test Button** - Removed from settings UI  
❌ **"Integration Status" Toggle** - No longer needed  
❌ **HTTP Server Configuration** - No need to configure Asterisk HTTP bind address  
❌ **ARI Modules** - No need to load or configure `res_ari*.so` modules  
❌ **Recording Symlinks** - No need for `/var/spool/asterisk/recording` symlink  

### Added/Updated

✅ **MySQL CDR Access** - Direct database queries for call records  
✅ **SSH/SFTP Download** - Download recordings via SSH (not ARI)  
✅ **SSH/SFTP Upload** - Upload redacted recordings via SSH  
✅ **Simplified Settings UI** - Only MySQL and SSH sections  
✅ **Test MySQL Button** - Verify MySQL CDR connection  
✅ **Test SSH Button** - Verify SSH/SFTP connection  
✅ **Auto-fallback Removed** - No ARI fallback logic  

---

## Technical Changes

### Backend

**Files Modified:**
- `backend/src/services/freepbx.service.js` - Removed ARI download, kept only for legacy compatibility
- `backend/src/services/freepbx-cdr.service.js` - Now uses SSH-only download, MySQL no longer requires `enabled` flag
- `backend/src/services/freepbx-ssh.service.js` - Added `downloadRecording()` method, removed `shouldUseSsh()` check
- `backend/src/config/env.js` - Removed `FREEPBX_USE_SSH_FOR_RECORDINGS` env var
- `backend/src/models/User.js` - Removed `enabled`, `host`, `port`, `username`, `tls`, `syncIntervalMinutes`, `hasPassword`, `useSshForRecordings` from FreePBX settings
- `backend/src/controllers/user.controller.js` - Removed ARI-related fields from settings save logic

**Behavior Changes:**
- ✅ CDR sync now works even if `enabled: false` (only needs MySQL credentials)
- ✅ Recording downloads always use SSH/SFTP (no ARI fallback)
- ✅ Sensitive-data redaction upload continues to work as before (already used SSH)

### Frontend

**Files Modified:**
- `frontend/types/call.ts` - Removed ARI fields from `FreePbxSettings` interface
- `frontend/app/(dashboard)/settings/freepbx/page.tsx` - Removed ARI section, Test ARI button, Integration Status toggle
- `frontend/app/(dashboard)/call-history/page.tsx` - Refresh button always visible (no conditions)

**UI Changes:**
- ✅ Cleaner settings page with only MySQL and SSH sections
- ✅ "Test MySQL" and "Test SSH" buttons for connection testing
- ✅ "Refresh" button always visible in Call History page
- ✅ No more confusing "Integration Status" toggle

### Documentation

**Files Updated:**
- `README.md` - Updated to reflect SSH+MySQL integration
- `FREEPBX_CONFIGURATION_GUIDE.md` - Complete rewrite for MySQL+SSH setup
- `FREEPBX_SETTINGS.md` - Updated with new connection architecture

**Files Deleted:**
- `ARI_CONNECTOR_FIX_SUMMARY.md` - No longer relevant
- `FREEPBX_ARI_TROUBLESHOOTING.md` - ARI-specific troubleshooting removed
- `FREEPBX_MANAGER_MODULE.md` - ARI connector module no longer needed

**Files To Be Updated (FreePBX Module):**
- `freepbx-module/README.md` - Still mentions ARI setup
- `freepbx-module/APP_INTEGRATION_GUIDE.md` - Still has ARI integration steps
- `freepbx-module/INSTALLATION_GUIDE.md` - May still reference ARI
- `freepbx-module/MYSQL_SETUP.md` - Should be fine, MySQL-focused

---

## Migration Guide for Existing Installations

If you're upgrading from an ARI-based installation:

### 1. Update Backend

```bash
cd /home/deployer/AI-Call-Analyzer/backend
git pull  # or update code
sudo -u deployer -H npm ci
sudo -u deployer -H pm2 restart ai-call-backend
```

### 2. Update Frontend

```bash
cd /home/deployer/AI-Call-Analyzer/frontend
git pull  # or update code
sudo -u deployer -H npm ci
sudo -u deployer -H npm run build
sudo -u deployer -H pm2 restart ai-call-frontend
```

**Important:** Production PM2 runs under the `deployer` user. Do not run `pm2` as `root` or you may restart the wrong PM2 daemon.

### 3. Update Settings in UI

1. Navigate to **Settings → FreePBX Integration**
2. You'll see the old ARI fields are gone
3. Fill in **MySQL** credentials (if not already configured)
4. Fill in **SSH** credentials (if not already configured)
5. Click **Test MySQL** and **Test SSH** to verify
6. Click **Save**

### 4. Verify Functionality

1. Go to **Call History** page
2. Click **Refresh** button
3. Verify new calls sync successfully
4. Play a recording to ensure SSH download works
5. Test sensitive-data redaction (if enabled) to ensure SSH upload works

---

## What You DON'T Need Anymore

### On FreePBX Server

You no longer need:
- ❌ ARI user in `/etc/asterisk/ari.conf`
- ❌ `http_custom.conf` with `bindaddr=0.0.0.0`
- ❌ `/var/spool/asterisk/recording` symlink
- ❌ Firewall rules for ports 8088/8089 (ARI HTTP/HTTPS)
- ❌ ARI modules loaded in Asterisk

### What You STILL Need

You must have:
- ✅ MySQL user with SELECT access to `asteriskcdrdb`
- ✅ MySQL listening on `0.0.0.0:3306` (or accessible IP)
- ✅ SSH server running on port 22 (or custom port)
- ✅ SSH user with read/write access to `/var/spool/asterisk/monitor`
- ✅ Firewall rules for ports 3306 (MySQL) and 22 (SSH)

---

## Benefits of the New Approach

### Reliability
- ✅ No more ARI HTTP bind address issues
- ✅ No more FreePBX overwriting `http_additional.conf`
- ✅ No more "Connection Refused" errors on fresh installs
- ✅ Works out-of-the-box without Asterisk configuration

### Simplicity
- ✅ Fewer moving parts (no ARI, no HTTP server config)
- ✅ Simpler firewall setup (just MySQL + SSH)
- ✅ Cleaner settings UI (no confusing toggles)
- ✅ Standard protocols (MySQL + SSH) that sysadmins understand

### Security
- ✅ SSH keys supported for authentication
- ✅ Read-only MySQL user for CDR access
- ✅ Dedicated SSH user possible (not root)
- ✅ Standard security practices apply

---

## Troubleshooting After Migration

### "No recordings syncing"

**Check:**
1. MySQL connection works: **Settings → FreePBX → Test MySQL**
2. SSH connection works: **Settings → FreePBX → Test SSH**
3. FreePBX is actually recording calls: `ls /var/spool/asterisk/monitor/`
4. Backend logs for errors: `pm2 logs ai-call-backend`

### "Can't play recordings"

**Check:**
1. SSH connection works: **Test SSH** button
2. SSH user has read access to `/var/spool/asterisk/monitor/`
3. Recordings base path is correct in settings
4. Backend logs show SSH download attempts

### "Sensitive-data redaction not working"

**Check:**
1. SSH connection works: **Test SSH** button
2. SSH user has **write** access to `/var/spool/asterisk/monitor/`
3. Backend logs for upload errors

---

## Support

For issues after migration:
1. Check backend logs: `pm2 logs ai-call-backend`
2. Test connections manually: `mysql -u aiapp -p -h FREEPBX_IP` and `ssh user@FREEPBX_IP`
3. Review updated documentation: `FREEPBX_CONFIGURATION_GUIDE.md`
4. Verify firewall rules allow MySQL (3306) and SSH (22) from your app server

---

## Rollback (If Needed)

If you need to temporarily rollback:

1. Checkout previous commit with ARI code
2. Rebuild frontend and backend
3. Restart services
4. Reconfigure ARI settings in UI

However, the new SSH+MySQL approach is more reliable and recommended for all installations.

---

**End of Migration Summary**

