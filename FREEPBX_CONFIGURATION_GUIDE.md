# FreePBX Configuration Guide for MySQL CDR + SSH Integration

This guide provides step-by-step instructions for configuring FreePBX to enable the AI Call Analysis application to fetch call records via MySQL and download/upload recordings via SSH.

## Prerequisites

- FreePBX 16.0.41.1 or compatible
- Asterisk 16.25.0 or compatible
- Root/SSH access to the FreePBX server
- A public IP address or network route from your application server to FreePBX

## Configuration Steps

### Step 1: Configure MySQL CDR Access

Create a dedicated MySQL user for the application to access the Call Detail Records database:

```bash
mysql -u root -p
```

Run the following SQL commands:

```sql
-- Create user for both localhost and remote access
CREATE USER IF NOT EXISTS 'aiapp'@'localhost' IDENTIFIED BY 'YOUR_SECURE_PASSWORD';
CREATE USER IF NOT EXISTS 'aiapp'@'%' IDENTIFIED BY 'YOUR_SECURE_PASSWORD';

-- Grant SELECT privileges on CDR database
GRANT SELECT ON asteriskcdrdb.* TO 'aiapp'@'localhost';
GRANT SELECT ON asteriskcdrdb.* TO 'aiapp'@'%';

-- Apply changes
FLUSH PRIVILEGES;

-- Verify user was created
SELECT user, host FROM mysql.user WHERE user = 'aiapp';

-- Test the user can access CDR data
SELECT COUNT(*) FROM asteriskcdrdb.cdr;
```

**Important Notes:**
- Replace `YOUR_SECURE_PASSWORD` with a strong password (12+ characters recommended)
- The username `aiapp` can be changed to any name you prefer
- `'aiapp'@'%'` allows connections from any IP; restrict to specific IP for better security

### Step 2: Configure MySQL for Remote Access

Edit MySQL configuration to allow remote connections:

```bash
nano /etc/my.cnf.d/server.cnf
```

Find the `[mysqld]` section and ensure `bind-address` is set correctly:

```ini
[mysqld]
bind-address = 0.0.0.0
```

If `bind-address` is commented out or set to `127.0.0.1`, change it to `0.0.0.0`.

Restart MySQL to apply changes:

```bash
systemctl restart mariadb
```

Verify MySQL is listening on all interfaces:

```bash
netstat -tulpn | grep 3306
```

Expected output should show `0.0.0.0:3306` (not `127.0.0.1:3306`).

### Step 3: Configure Firewall for MySQL

Open MySQL port in the firewall:

```bash
firewall-cmd --permanent --add-port=3306/tcp
firewall-cmd --reload
```

Or restrict to your application server's specific IP:

```bash
firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="YOUR_APP_SERVER_IP" port protocol="tcp" port="3306" accept'
firewall-cmd --reload
```

### Step 4: Test MySQL Connection

From your application server (or another machine), test the MySQL connection:

```bash
mysql -u aiapp -p -h YOUR_FREEPBX_IP asteriskcdrdb
```

Enter the password when prompted. Once connected, verify you can query CDR data:

```sql
SELECT COUNT(*) FROM cdr;
SELECT calldate, src, dst, disposition, recordingfile FROM cdr ORDER BY calldate DESC LIMIT 5;
```

You should see your recent call records.

### Step 5: Configure SSH Access

The application uses SSH/SFTP to download recordings and upload redacted versions.

**Option A: Use root account (simpler but less secure)**

Ensure SSH is enabled and accessible:

```bash
systemctl status sshd
systemctl enable sshd
systemctl start sshd
```

If using a custom SSH port, note it for later.

**Option B: Create dedicated user (recommended)**

```bash
# Create a user for the application
useradd -m -s /bin/bash callanalyzer

# Set password
passwd callanalyzer

# Grant access to recordings directory
usermod -aG asterisk callanalyzer
chown -R asterisk:asterisk /var/spool/asterisk/monitor
chmod g+rwx /var/spool/asterisk/monitor
```

### Step 6: Configure Firewall for SSH

Ensure SSH port is open:

```bash
firewall-cmd --permanent --add-service=ssh
firewall-cmd --reload
```

Or if using a custom port:

```bash
firewall-cmd --permanent --add-port=YOUR_SSH_PORT/tcp
firewall-cmd --reload
```

### Step 7: Test SSH Connection

From your application server, test SSH connection:

```bash
ssh root@YOUR_FREEPBX_IP
# or
ssh -p YOUR_SSH_PORT root@YOUR_FREEPBX_IP
```

Once connected, verify you can access recordings:

```bash
ls -la /var/spool/asterisk/monitor/
```

You should see your call recordings organized by date.

### Step 8: Configure Application Settings

In your AI Call Analysis application:

1. Navigate to **Settings → FreePBX Integration**

2. Configure **MySQL Database Access (CDR)**:
   - **MySQL Host:** `YOUR_FREEPBX_IP` (e.g., `140.82.47.197`)
   - **MySQL Port:** `3306` (default)
   - **MySQL Username:** `aiapp` (or whatever you configured in Step 1)
   - **MySQL Password:** Your password from Step 1
   - **Database Name:** `asteriskcdrdb` (default)

3. Click **Test MySQL** to verify connection

4. Configure **SSH Access (Recording Download & Redaction)**:
   - **SSH Host:** `YOUR_FREEPBX_IP`
   - **SSH Port:** `22` (or your custom port)
   - **SSH Username:** `root` or `callanalyzer`
   - **SSH Password** OR **SSH Private Key**
   - **Recordings Base Path:** `/var/spool/asterisk/monitor`

5. Click **Test SSH** to verify connection

6. Click **Save**

### Step 9: Test Recording Sync

1. Make a test call to FreePBX and ensure it's recorded
2. In the application, navigate to **Call History** page
3. Click **Refresh** to manually trigger a sync
4. Verify the new call appears with:
   - Proper caller ID
   - Audio playback (via SSH download)
   - AI transcript
   - Sentiment analysis

## Troubleshooting

### Issue: "Access denied" for MySQL user

**Cause:** User doesn't exist or password is incorrect.

**Fix:** Verify user credentials:
```bash
mysql -u root -p
SELECT user, host FROM mysql.user WHERE user = 'aiapp';
```

If user doesn't exist, recreate it (see Step 1).

### Issue: "Can't connect to MySQL server"

**Cause:** MySQL is not listening on `0.0.0.0` or firewall is blocking.

**Fix:** 
1. Check MySQL bind address:
   ```bash
   grep bind-address /etc/my.cnf.d/server.cnf
   netstat -tulpn | grep 3306
   ```
2. Should show `0.0.0.0:3306`, not `127.0.0.1:3306`
3. Check firewall:
   ```bash
   firewall-cmd --list-ports | grep 3306
   ```

### Issue: "SSH connection refused"

**Cause:** SSH is not running or firewall is blocking.

**Fix:**
1. Verify SSH is running:
   ```bash
   systemctl status sshd
   ```
2. Check firewall:
   ```bash
   firewall-cmd --list-services | grep ssh
   ```

### Issue: "Permission denied" when accessing recordings via SSH

**Cause:** SSH user doesn't have read access to `/var/spool/asterisk/monitor`.

**Fix:**
```bash
# Add user to asterisk group
usermod -aG asterisk YOUR_SSH_USER

# Ensure directory permissions allow group read
chmod g+rwx /var/spool/asterisk/monitor
```

### Issue: SSH connection works but can't upload redacted recordings

**Cause:** SSH user doesn't have write access.

**Fix:**
```bash
# Ensure user has write access
chmod g+w /var/spool/asterisk/monitor
chown -R asterisk:asterisk /var/spool/asterisk/monitor
```

### Issue: No recordings in sync

**Cause:** FreePBX is not recording calls.

**Fix:**
1. Verify recording is enabled in FreePBX:
   - Navigate to **Admin → System Recordings**
   - Check inbound/outbound route recording settings
2. Make a test call and verify recording file exists:
   ```bash
   ls -ltr /var/spool/asterisk/monitor/ | tail -10
   ```

## Files Modified Summary

| File | Purpose | Key Changes |
|------|---------|-------------|
| `/etc/my.cnf.d/server.cnf` | MySQL bind address | Set `bindaddr=0.0.0.0` for remote access |
| MySQL user table | CDR database access | Created `aiapp` user with SELECT privileges |

## Security Recommendations

1. **Use strong passwords:** MySQL password should be at least 12 characters with mixed case, numbers, and symbols.
2. **Restrict MySQL access:** Use specific IP instead of `'aiapp'@'%'`:
   ```sql
   CREATE USER 'aiapp'@'YOUR_APP_SERVER_IP' IDENTIFIED BY 'password';
   GRANT SELECT ON asteriskcdrdb.* TO 'aiapp'@'YOUR_APP_SERVER_IP';
   ```
3. **Use SSH keys:** Instead of password authentication, use SSH key pairs for better security.
4. **Create dedicated SSH user:** Don't use root; create `callanalyzer` user with minimal privileges.
5. **Firewall restrictions:** Only allow connections from your application server's IP.

## Version Compatibility

This configuration has been tested with:
- FreePBX 16.0.41.1
- Asterisk 16.25.0
- MariaDB 5.5 / MySQL 5.7+
- PBX Distro 12.7.8-2204-1.sng7

For other versions, configuration syntax may vary slightly.

## Support

If you encounter issues not covered in this guide:
1. Check MySQL logs: `tail -f /var/log/mariadb/mariadb.log`
2. Check SSH logs: `tail -f /var/log/secure`
3. Check application backend logs for detailed error messages
4. Test MySQL and SSH connections manually before troubleshooting the application

---

**Last Updated:** January 3, 2026
**Configuration Version:** 2.0 (SSH + MySQL only, no ARI)
