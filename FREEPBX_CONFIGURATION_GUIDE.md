# FreePBX Configuration Guide for ARI Integration

This guide provides step-by-step instructions for configuring FreePBX/Asterisk to enable the AI Call Analysis application to connect via ARI (Asterisk REST Interface) and download call recordings.

## Prerequisites

- FreePBX 16.0.41.1 or compatible
- Asterisk 16.25.0 or compatible
- Root/SSH access to the FreePBX server
- A public IP address or network route from your application server to FreePBX

## Configuration Steps

### Step 1: Configure ARI User Credentials

Edit `/etc/asterisk/ari.conf` and configure the ARI user:

```bash
nano /etc/asterisk/ari.conf
```

Add or modify the following sections:

```ini
[general]
allowed_origins = *
recording_directory = /var/spool/asterisk/monitor

[connex]
type = user
read_only = no
password = YOUR_SECURE_PASSWORD_HERE
password_format = plain
```

**Important Notes:**
- Replace `YOUR_SECURE_PASSWORD_HERE` with a strong password
- The username `[connex]` can be changed to any name you prefer
- `allowed_origins = *` must be in the `[general]` section (Asterisk 16 requirement)
- `recording_directory` points to where call recordings are stored

### Step 2: Configure HTTP Server for External Access

The Asterisk HTTP server needs to listen on a public IP (not just localhost) for external ARI connections.

**Option A: Using http_custom.conf (Recommended)**

Create/edit `/etc/asterisk/http_custom.conf`:

```bash
nano /etc/asterisk/http_custom.conf
```

Add the following:

```ini
[general]
bindaddr=0.0.0.0
```

This overrides the `bindaddr` setting from `http_additional.conf` without FreePBX reverting it.

**Option B: Verify http_additional.conf (if http_custom.conf doesn't work)**

Check `/etc/asterisk/http_additional.conf`:

```bash
cat /etc/asterisk/http_additional.conf
```

If `bindaddr` is set to a specific IP or `::`, ensure your firewall allows connections to port 8088 (HTTP) and 8089 (HTTPS).

**Important:** Do NOT set `bindaddr` to a specific IP in `http_additional.conf` if it causes SIP/PJSIP transport binding conflicts. Use `http_custom.conf` to override it instead.

### Step 3: Configure Recording Directory Symlink

ARI expects recordings in `/var/spool/asterisk/recording`, but FreePBX stores them in `/var/spool/asterisk/monitor`. Create a symlink:

```bash
# Remove any existing recording directory or symlink
rm -rf /var/spool/asterisk/recording

# Create symlink pointing to monitor directory
ln -s /var/spool/asterisk/monitor /var/spool/asterisk/recording

# Verify the symlink
ls -la /var/spool/asterisk/ | grep recording
readlink /var/spool/asterisk/recording
```

Expected output:
```
lrwxrwxrwx   1 root     root         27 Nov 23 18:11 recording -> /var/spool/asterisk/monitor
/var/spool/asterisk/monitor
```

### Step 4: Load ARI Modules

Ensure all required ARI modules are loaded in Asterisk:

```bash
# Enter Asterisk CLI
asterisk -rvvv

# Load ARI modules
module load res_ari.so
module load res_ari_recordings.so
module load res_ari_channels.so
module load res_ari_bridges.so

# Verify modules are loaded
module show like ari

# Exit CLI
exit
```

Expected output should show all `res_ari*.so` modules as "Running".

### Step 5: Reload Asterisk Configuration

Apply all configuration changes:

```bash
fwconsole reload
```

Alternatively, reload specific modules:

```bash
asterisk -rx "module reload res_http.so"
asterisk -rx "module reload res_ari.so"
asterisk -rx "module unload res_ari_recordings.so"
asterisk -rx "module load res_ari_recordings.so"
```

### Step 6: Configure Firewall Rules

Ensure the firewall allows inbound connections to ARI ports:

```bash
# Add firewall rules for ARI HTTP/HTTPS
firewall-cmd --permanent --add-port=8088/tcp
firewall-cmd --permanent --add-port=8089/tcp
firewall-cmd --reload

# Or use FreePBX firewall command
fwconsole firewall --add=8088/tcp
fwconsole firewall --add=8089/tcp
```

**Important:** If your application server has a different IP, add it to the FreePBX firewall trusted list.

### Step 7: Verify Configuration

Test the ARI connection from your application server or local machine:

**Test 1: List Recordings**
```bash
curl -u "connex:YOUR_PASSWORD" http://YOUR_FREEPBX_IP:8088/ari/recordings/stored
```

Expected output (JSON array of recordings):
```json
[
  {
    "name": "2025/11/23/out-7175882255-200-20251123-175133-1763938293.6",
    "format": "wav"
  }
]
```

**Test 2: Download a Recording**
```bash
curl -u "connex:YOUR_PASSWORD" "http://YOUR_FREEPBX_IP:8088/ari/recordings/stored/2025%2F11%2F23%2Fout-7175882255-200-20251123-175133-1763938293.6/file" -o test.wav
```

The downloaded file should be a valid WAV file (100KB+), not a 33-byte JSON error.

### Step 8: Configure Application Frontend

In your AI Call Analysis application:

1. Navigate to **Settings → FreePBX Integration**
2. Enter the following credentials:
   - **Host:** `YOUR_FREEPBX_IP` (e.g., `140.82.47.197`)
   - **Port:** `8088` (HTTP) or `8089` (HTTPS)
   - **Username:** `connex` (or whatever you configured in Step 1)
   - **Password:** Your secure password from Step 1
   - **Use TLS:** Enable if using port 8089
   - **Sync Interval:** `10` minutes (or your preference)
3. Click **Test Connection** to verify
4. Click **Save**

### Step 9: Test Manual Sync

Click **Sync FreePBX** in the application to manually trigger a recording sync. New recordings should appear in the call list with:
- Proper caller ID
- Correct call duration
- Full AI transcript
- Sentiment analysis

## Troubleshooting

### Issue: "Connection Refused" Error

**Cause:** Asterisk HTTP server is not listening on the public IP.

**Fix:** Verify `bindaddr=0.0.0.0` in `/etc/asterisk/http_custom.conf` and reload:
```bash
fwconsole reload
asterisk -rx "http show status"
```

Expected output should show:
```
Server Enabled and Bound to 0.0.0.0:8088
```

### Issue: "401 Unauthorized" Error

**Cause:** Incorrect ARI username/password.

**Fix:** Verify credentials in `/etc/asterisk/ari.conf` and reload:
```bash
cat /etc/asterisk/ari.conf | grep -A5 "\[connex\]"
fwconsole reload
```

### Issue: "404 Not Found" for /ari/recordings/stored

**Cause:** ARI modules are not loaded.

**Fix:** Load ARI modules (see Step 4) and verify:
```bash
asterisk -rx "module show like ari"
```

### Issue: "Recording not found" when downloading

**Cause:** Recording symlink is incorrect or ARI is looking in the wrong directory.

**Fix:** 
1. Verify symlink: `readlink /var/spool/asterisk/recording`
2. Should output: `/var/spool/asterisk/monitor`
3. If not, recreate symlink (see Step 3)
4. Reload ARI recordings module:
```bash
asterisk -rx "module unload res_ari_recordings.so"
asterisk -rx "module load res_ari_recordings.so"
```

### Issue: Inbound calls stopped working after configuration

**Cause:** `bindaddr` change in `http.conf` caused PJSIP transport binding conflict.

**Fix:** Use `http_custom.conf` to override bindaddr instead of editing `http_additional.conf`:
```bash
echo -e "[general]\nbindaddr=0.0.0.0" > /etc/asterisk/http_custom.conf
fwconsole reload
```

Verify PJSIP transports are bound correctly:
```bash
asterisk -rx "pjsip show transports"
```

Check that your SIP port (e.g., 57293) shows in netstat:
```bash
netstat -tulpn | grep asterisk | grep YOUR_SIP_PORT
```

### Issue: Recordings show 0 seconds and no transcript

**Cause:** Backend failed to download the recording from FreePBX.

**Fix:** Check backend logs for errors, verify:
1. ARI connection works (curl test from Step 7)
2. Recording symlink is correct
3. Firewall allows connections
4. Restart backend and click "Sync FreePBX" again

## Files Modified Summary

| File | Purpose | Key Changes |
|------|---------|-------------|
| `/etc/asterisk/ari.conf` | ARI user credentials | Added `[connex]` user, `allowed_origins`, `recording_directory` |
| `/etc/asterisk/http_custom.conf` | HTTP server bind address | Set `bindaddr=0.0.0.0` for external access |
| `/var/spool/asterisk/recording` | Recording directory symlink | Created symlink to `/var/spool/asterisk/monitor` |

## Security Recommendations

1. **Use strong passwords:** The ARI password should be at least 20 characters with mixed case, numbers, and symbols.
2. **Enable TLS:** Use port 8089 with TLS enabled instead of plain HTTP on 8088.
3. **Firewall restrictions:** Only allow connections from your application server's IP, not `0.0.0.0`.
4. **Read-only access:** If your application only needs to download recordings, set `read_only = yes` in `ari.conf`.

## Version Compatibility

This configuration has been tested with:
- FreePBX 16.0.41.1
- Asterisk 16.25.0
- PBX Distro 12.7.8-2204-1.sng7

For other versions, configuration syntax may vary slightly. Consult Asterisk ARI documentation for your specific version.

## Support

If you encounter issues not covered in this guide:
1. Check Asterisk logs: `tail -f /var/log/asterisk/full`
2. Check application backend logs for detailed error messages
3. Verify all steps were completed in order
4. Test ARI connection manually using curl before troubleshooting the application

---

**Last Updated:** November 23, 2025
**Configuration Version:** 1.0

