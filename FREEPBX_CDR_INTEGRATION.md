# FreePBX CDR Database Integration

## Overview

The app syncs call records directly from FreePBX's MySQL CDR database (`asteriskcdrdb.cdr`), providing an alternative to the ARI REST API method.

## Configuration

**Settings → FreePBX Integration → MySQL CDR Access**

- **MySQL Host**: FreePBX server IP
- **MySQL Port**: `3306` (default)
- **MySQL Username**: Database user (typically `asteriskuser`)
- **MySQL Password**: Database password
- **MySQL Database**: `asteriskcdrdb` (default)
- **Enable CDR Sync**: Toggle on

## How It Works

### Sync Process

1. **Automatic**: Runs every 10 minutes (background job)
2. **Manual**: Click "Sync CDR" button on Call History page
3. **Incremental**: Only fetches records newer than last sync

### Query Filter (Main Dial Legs Only)

```sql
WHERE dstchannel IS NOT NULL
  AND dstchannel != ''
  AND lastapp = 'Dial'
```

**Why these filters?**
- **Avoid duplicates**: FreePBX can create multiple CDR legs per call; the `Dial` rows with a real `dstchannel` are typically the main leg you want to show.\n+- **Includes answered and unanswered calls**: We do **not** filter by `disposition`, so NO ANSWER / BUSY / FAILED calls are included.

### What Gets Synced

- Main-leg calls (answered + unanswered) from CDR
- Caller/callee info from CDR columns (`cnum`, `cnam`, `dst`, `dst_cnam`)
- Recording file path (if exists)
- Call timestamp, duration, disposition

### Recording Processing

If `disposition = 'ANSWERED'` and `recordingfile` exists in CDR:
1. Download via SSH/SFTP (recordings path)
2. Transcribe with OpenAI Whisper
3. Analyze with GPT-4

If unanswered (NO ANSWER/BUSY/FAILED/etc.), or if no recording is available:
- Skip audio/transcript/AI processing
- Mark call `completed`
- Store a minimal summary (`Unanswered call`) and show a red disposition label in the Call History table

### Call Direction (Inbound/Outbound)

For FreePBX CDR calls, the app persists a `calls.direction` value (`inbound` / `outbound` / null) using a heuristic:\n+- Prefer the internal extension from `cnum` when it is 3–4 digits.\n+- Use `dst` when it is a 3–4 digit extension.\n+- Treat DID/ring-group style inbound flows as inbound when the source is external and `did`/`dcontext` indicates an inbound route (e.g., `ext-group`, `ext-queues`, `from-trunk`).

### Call History Filters (server-side)

The Calls page supports composable filters (ANDed together):\n+- Direction (Inbound/Outbound)\n+- Booking\n+- Sentiment\n+- No Answer (any non-ANSWERED disposition)\n+\n+These are sent to the backend via:\n+- `GET /api/v1/cdr-calls`\n+- `GET /api/v1/cdr-calls/ids` (for bulk selection)

## CDR vs ARI REST API

| Method | Source | Filters | Use Case |
|--------|--------|---------|----------|
| **CDR Database** | MySQL `cdr` table | Extension-level calls | Complete call history with metadata |
| **ARI REST API** | `/ari/recordings/stored` | Only calls with recording files | Recording-focused sync |

**Recommendation**: Use CDR integration for comprehensive call history.

## Troubleshooting

**Ring group calls appearing?**
- Expected: the app includes main Dial legs (answered + unanswered). Filtering is done by `lastapp='Dial'` and `dstchannel` presence, not by ring-group number.

**No calls syncing?**
- Test MySQL connection in Settings
- Check `backend` logs for errors
- Verify user has SELECT permission on `asteriskcdrdb.cdr`

**Duplicate calls?**
- Sync uses `uniqueid` as unique identifier to prevent duplicates

## Technical Details

- **Service**: `backend/src/services/freepbx-cdr.service.js`
- **Sync Job**: `backend/src/jobs/freepbx-cdr-sync.job.js`
- **Controller**: `backend/src/controllers/freepbx-cdr.controller.js`

