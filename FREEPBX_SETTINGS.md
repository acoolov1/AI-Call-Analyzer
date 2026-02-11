# FreePBX Integration Settings

## Overview

The AI Call Analysis application integrates with FreePBX using two connection methods:

1. **MySQL CDR Access** - Fetches call detail records from the `asteriskcdrdb` database
2. **SSH/SFTP Access** - Downloads recordings and uploads redacted versions

No Asterisk REST Interface (ARI) connection is required.

## Connection Architecture

```
┌─────────────────────┐
│                     │
│   AI Call Analyzer  │
│                     │
└──────┬──────┬───────┘
       │      │
       │      └──────────────┐
       │                     │
       ▼                     ▼
┌──────────────┐      ┌──────────────┐
│    MySQL     │      │     SSH      │
│  Port 3306   │      │   Port 22    │
└──────┬───────┘      └──────┬───────┘
       │                     │
       └────────┬────────────┘
                │
        ┌───────▼────────┐
        │    FreePBX     │
        │   Asterisk     │
        └────────────────┘
```

## Platform Baseline

- **PBX Version:** 16.0.41.1  
- **PBX Distro:** 12.7.8-2204-1.sng7  
- **Asterisk Version:** 16.25.0
- **MySQL/MariaDB:** 5.5+

These versions ship with MySQL and SSH enabled by default. The integration outlined
in this repo expects at least feature parity with this stack.

## Credentials & Network Requirements

| Item | Description | Notes |
|------|-------------|-------|
| MySQL Host / IP | Reachable address of the FreePBX/Asterisk server | Prefer private network or VPN |
| MySQL Port | Default `3306` | Standard MySQL/MariaDB port |
| MySQL Username | CDR database user | Create dedicated user such as `aiapp` |
| MySQL Password | User password | Use strong password (12+ characters) |
| MySQL Database | CDR database name | Default is `asteriskcdrdb` |
| SSH Host | Same as MySQL host | Uses same FreePBX server |
| SSH Port | Default `22` | May be customized for security |
| SSH Username | System user with recording access | `root` or dedicated user like `callanalyzer` |
| SSH Password / Private Key | Authentication method | SSH keys recommended for production |
| Recordings Base Path | Directory where recordings are stored | Default is `/var/spool/asterisk/monitor` |

Firewall rules must allow the backend host to connect to MySQL (port 3306) and SSH (port 22).

## API Surface Needed

1. **MySQL CDR Access**  
   - `SELECT` access to `asteriskcdrdb.cdr` table
   - Queries filter by `calldate` to fetch recent records
   - Returns caller info, timestamps, disposition, and recording file paths

2. **SSH/SFTP Access**  
   - Read access to `/var/spool/asterisk/monitor/` for downloading recordings
   - Write access to same directory for uploading redacted recordings
   - Supports both password and SSH key authentication

The backend normalizes MySQL CDR records and SSH recording paths into the shared calls schema.

## Frontend Configuration Steps

1. Sign in to the dashboard and open **Settings ▸ FreePBX Integration**.
2. Fill in the MySQL credentials (host, port, username, password, database).
3. Fill in the SSH credentials (host, port, username, password/private key, base path).
4. Click **Save settings** – credentials are stored encrypted per-user.
5. Use **Test MySQL** and **Test SSH** to confirm connections are working.
6. Navigate to **Call History** and click **Refresh** to pull recordings immediately.
7. Automatic sync runs every 10 minutes by default.

Calls sourced from FreePBX display a `FreePBX` badge in the call list and behave
identically to Twilio calls (audio playback, transcript, AI analysis).

For FreePBX CDR calls, the Call History page also supports:
- **Unanswered calls** (NO ANSWER/BUSY/FAILED/etc.) shown with a red label (no processing)
- **Direction** column (Inbound/Outbound) computed and stored during CDR ingest
- **Add Filter** UI to compose server-side filters (Direction/Booking/Sentiment/No Answer)

## Manual Testing Checklist

1. Place a call that FreePBX records to disk.
2. In the dashboard, click **Refresh** on the Call History page and wait for confirmation.
3. Verify the new call appears with the FreePBX badge.
4. Expand the row to confirm:\n+   - the **duration** shows immediately (from CDR-derived duration)\n+   - audio playback works and **scrubbing/seek** is reliable (streamed with HTTP Range support over SSH)
5. Ensure the transcript and AI summary are generated (status switches to **Completed**).
6. If sensitive-data redaction is enabled (PCI + PII/PHI), verify sensitive data is muted in the audio.
7. Place a missed call (NO ANSWER/BUSY/FAILED) and confirm:\n+   - it appears in Call History with a red disposition label\n+   - “Summary” shows `Unanswered call`\n+   - Direction is shown when detectable (including DID/ring group calls)\n+8. Use **Add Filter** to verify combined filtering (e.g., Inbound + No Answer).

## Recordings Folder Stats (Settings UI)

On **Settings ▸ FreePBX Integration**, the UI can query the configured recordings base path and display:
- base path
- file count
- total size (MB)
- oldest and newest recording day found (derived from `YYYY/MM/DD` folders)
  - displayed as `MM/DD/YY – MM/DD/YY. N days`

This is fetched once on page load from:
- `GET /api/v1/integrations/freepbx/recordings-stats` (authenticated; uses SSH `find` + `du`)

## Recording Retention (Auto-Delete)

The FreePBX Integration page also supports **automatic recording deletion** via SSH, per user.

- **Enable retention**: toggles the feature on/off
- **Retention days**: keep the most recent **N calendar days** (inclusive), based on the `YYYY/MM/DD` folder structure
- **Run time (daily)**: one daily HH:MM time in the user’s selected timezone

### What the UI shows

- **Schedule**: `Last run: <local time> (<X files deleted>) • Next: <local time>`
  - Times are shown in the selected user’s timezone.
  - The “files deleted” count is the number of candidate audio files found/deleted during the last run.

### Notes

- Deletion operates on day folders under the recordings base path (e.g. `/var/spool/asterisk/monitor/YYYY/MM/DD/`).
- For testing, set the run time a few minutes in the future and save; you can change the time again to re-run later the same day.

## Security Recommendations

### MySQL Security
- Create a dedicated read-only user for CDR access
- Restrict access by IP address instead of allowing all hosts (`'user'@'SPECIFIC_IP'`)
- Use strong passwords (12+ characters, mixed case, numbers, symbols)
- Consider using SSL/TLS for MySQL connections

### SSH Security
- Use SSH key authentication instead of passwords in production
- Create a dedicated system user instead of using root
- Use a non-standard SSH port (not 22) for added security
- Limit user access to only the recordings directory
- Configure firewall to only allow connections from application server IP

## Future Considerations

- If near-real-time ingestion is needed, implement database triggers or FreePBX hooks
  that notify the backend when a new recording is finalized.
- Multi-tenant deployments should scope MySQL users per PBX to avoid cross-account
  leakage.
- Consider implementing connection pooling for MySQL if handling high call volumes.

## Troubleshooting

### MySQL Connection Issues

**"Access denied for user":**
- Verify username and password in FreePBX settings
- Check MySQL user exists: `SELECT user, host FROM mysql.user WHERE user = 'aiapp';`
- Ensure user has SELECT privilege: `SHOW GRANTS FOR 'aiapp'@'%';`

**"Can't connect to MySQL server":**
- Verify MySQL is listening on `0.0.0.0`: `netstat -tulpn | grep 3306`
- Check firewall allows port 3306: `firewall-cmd --list-ports | grep 3306`
- Test connection manually: `mysql -u aiapp -p -h YOUR_FREEPBX_IP asteriskcdrdb`

### SSH Connection Issues

**"Connection refused":**
- Verify SSH is running: `systemctl status sshd`
- Check firewall allows SSH port: `firewall-cmd --list-services | grep ssh`
- Test connection manually: `ssh -p YOUR_PORT user@YOUR_FREEPBX_IP`

**"Permission denied":**
- Verify username and password/key are correct
- Check SSH user has access to recordings: `ls -la /var/spool/asterisk/monitor/`
- Add user to asterisk group: `usermod -aG asterisk YOUR_SSH_USER`

### Recording Download/Upload Issues

**"No such file or directory":**
- Verify recordings base path is correct: `ls /var/spool/asterisk/monitor/`
- Check recording files exist with correct date structure: `ls /var/spool/asterisk/monitor/YYYY/MM/DD/`

**"Permission denied" when uploading:**
- Ensure SSH user has write access: `chmod g+w /var/spool/asterisk/monitor`
- Verify directory ownership: `chown -R asterisk:asterisk /var/spool/asterisk/monitor`
