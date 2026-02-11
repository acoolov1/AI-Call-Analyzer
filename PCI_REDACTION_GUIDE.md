# Sensitive-Data Redaction Guide (PCI + PII/PHI)

## Overview

The AI Call Analyzer includes **sensitive-data redaction** to automatically detect and remove sensitive information from both **audio recordings** and **transcripts**.

It started as **PCI-focused redaction** (credit card numbers, CVV codes, expiry dates) and has been expanded to cover common **PII/PHI-style** data such as:
- Date of birth (DOB)
- Social Security Numbers (SSNs)
- Email addresses
- Addresses
- Passwords / PINs

This is a technical control to reduce retention of sensitive spoken data. It does not replace a full compliance program (PCI DSS / HIPAA).

---

## 🔒 How It Works

### 1. **Keyword-Based Detection**
When a call is transcribed, the system uses **keyword detection + lightweight heuristics** to identify sensitive information:

**Detected Keywords:**
- Credit card related: `credit`, `card`, `visa`, `mastercard`, `amex`, `discover`, `debit`, `payment`
- CVV related: `cvv`, `cvc`, `security code`, `verification code`
- Expiry related: `expir`, `expiration`, `exp date`, `valid through`
- DOB related: `dob`, `birthday`, `birthdate`, `date of birth`
- Password/PIN related: `password`, `passcode`, `pin`, `pincode`
- Address related: `address`, `street address`

When these keywords are detected, the system looks for **any numbers** spoken within the next ~15 words and marks them for redaction.

**Important:** You don't need to provide a full 16-digit card number. Even partial numbers (like "353-453") will be detected and redacted if preceded by keywords like "credit card number".

### 2. **Text Redaction**
The transcript text is sanitized by replacing sensitive spans with `[REDACTED]`:

**Before:**
```
Hello, my credit card number is 4532 1488 0343 6467 and the CVV is 123.
```

**After:**
```
Hello, my credit card [REDACTED]. Can you guys ship it tomorrow?
```

### 3. **Audio Redaction**
The system uses **FFmpeg** to mute the audio segments containing sensitive information:

- Whisper API provides **word-level timestamps** for each spoken word
- Detected spans are mapped to time ranges (e.g., 17.22s - 20.62s)
- **0.5 second padding** is added before/after to account for timestamp drift
- FFmpeg mutes those segments using a volume filter
- The redacted audio buffer is created **without re-encoding** (fast)

**Note on DOB audio muting:** DOB spans are muted more conservatively (digit-only span + tighter padding) to reduce the chance of muting adjacent non-sensitive words.

### 4. **FreePBX File Replacement**
For FreePBX calls, the redacted audio is uploaded back to replace the original:

- Connects via **SSH/SFTP** to FreePBX server
- Uploads redacted audio to temporary file
- **Deletes** the original recording
- Renames temp file to original filename
- **Result:** Original unredacted audio is permanently removed

**⚠️ Important:** This is a **destructive operation**. The original recording is deleted and cannot be recovered.

---

## 🛠️ Setup

### Prerequisites
1. **FFmpeg** installed on the server running the backend
   ```bash
   # Ubuntu/Debian
   sudo apt-get install ffmpeg
   
   # macOS
   brew install ffmpeg
   ```

2. **SSH access to FreePBX** (for FreePBX calls only)
   - Root user or user with write permissions to `/var/spool/asterisk/monitor/`
   - SSH password or private key authentication

### Configuration

#### Option 1: Environment Variables (Backend .env)
```env
FREEPBX_SSH_HOST=140.82.47.197
FREEPBX_SSH_PORT=22
FREEPBX_SSH_USERNAME=root
FREEPBX_SSH_PASSWORD=your_password
FREEPBX_SSH_BASE_PATH=/var/spool/asterisk/monitor
```

#### Option 2: User Settings UI (Recommended)
1. Navigate to **Settings → FreePBX Integration** in the frontend
2. Scroll to **SSH Upload (Redaction Overwrite)** section
3. Fill in:
   - **SSH Host**: Your FreePBX server IP/hostname
   - **SSH Port**: Usually `22`
   - **SSH Username**: `root` (or restricted user with write access)
   - **SSH Password** OR **SSH Private Key** (PEM format)
   - **Recordings Base Path**: `/var/spool/asterisk/monitor` (default)
4. Click **Test SSH** to verify connection
5. Click **Save Settings**

---

## 🔍 How to Verify It's Working

### 1. Check Transcript
- Place a test call and say: "My credit card number is 4532 1234"
- View the call in Call History
- Transcript should show: "My credit card [REDACTED]"

### 2. Check Audio
- Play back the recording
- The audio should be **silent** during the credit card number portion
- You should still hear everything before and after

### 3. Check Database
The `calls` table includes redaction tracking fields:

```sql
SELECT 
  id, 
  redaction_status,   -- 'not_needed', 'processing', 'completed', 'failed'
  redacted,            -- true/false
  redacted_segments,   -- JSON array of time spans
  redacted_at          -- timestamp when redaction completed
FROM calls 
WHERE id = 'your-call-id';
```

**Example `redacted_segments`:**
```json
[
  {
    "start": 17.22,
    "end": 20.62,
    "reason": "card_number"
  }
]
```

### 4. Check FreePBX File
- SSH into FreePBX server
- Navigate to `/var/spool/asterisk/monitor/YYYY/MM/DD/`
- Download the recording file
- Play it locally - sensitive audio should be muted

---

## 📊 Technical Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Call Recording Downloaded from FreePBX                   │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Whisper Transcription (verbose_json + word timestamps)   │
│    Returns: text + array of {word, start, end}              │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. PCI Detection (keyword-based)                            │
│    - Scan for: "credit card", "cvv", etc.                   │
│    - Find nearby numbers within 15-word window              │
│    - Map to time spans using word timestamps                │
│    - Add 0.5s padding before/after                          │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ├──> No PCI data → Skip to analysis
                  │
                  ▼ PCI data detected
┌─────────────────────────────────────────────────────────────┐
│ 4. Update Database: redaction_status = 'processing'         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. FFmpeg Audio Redaction                                   │
│    - Write audio buffer to temp file                        │
│    - Run: ffmpeg -i input.wav -af                           │
│      "volume=enable='between(t,17.22,20.62)':volume=0"      │
│      output.wav                                              │
│    - Read redacted buffer                                   │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. SSH Upload to FreePBX                                    │
│    - Connect via SFTP                                       │
│    - Upload to temp: .tmp-redacted-[timestamp]-filename.wav │
│    - Delete original: filename.wav                          │
│    - Rename temp → filename.wav                             │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Text Sanitization                                        │
│    - Replace detected spans with "[REDACTED]"               │
│    - Use sanitized text for GPT analysis                    │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. Final Database Update                                    │
│    - transcript: sanitized text                             │
│    - redaction_status: 'completed'                          │
│    - redacted: true                                         │
│    - redacted_segments: JSON time spans                     │
│    - redacted_at: timestamp                                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔐 PCI Compliance Notes

### What This Feature Does
✅ Automatically detects payment card data in call recordings  
✅ Mutes audio containing sensitive data  
✅ Redacts text transcripts  
✅ Permanently deletes original unredacted recordings  
✅ Maintains audit trail (redaction status, timestamps, segments)  
✅ Works without human intervention (automatic)  

### What This Feature Doesn't Do
❌ Does not guarantee 100% detection accuracy (AI-based detection)  
❌ Does not redact data spoken unclearly or with heavy accents  
❌ Does not apply to calls already processed before feature was enabled  
❌ Does not prevent agents from writing down card numbers  

### Recommendations for Full PCI Compliance
1. **Scope reduction**: Minimize systems that handle cardholder data
2. **Agent training**: Train agents to never write down or store card data
3. **IVR payment solution**: Use IVR/DTMF for card input (never spoken)
4. **Third-party tokenization**: Use services like Stripe Terminal or TrustCommerce
5. **Regular audits**: Review redaction logs and sample calls
6. **Network segmentation**: Isolate call recording systems
7. **Access controls**: Limit who can access recordings

**Disclaimer:** This feature is a **technical control** to reduce PCI scope. It does not replace a comprehensive PCI DSS compliance program. Consult with a Qualified Security Assessor (QSA) for full compliance.

---

## 🐛 Troubleshooting

### Audio Not Redacted
1. **Check FFmpeg installation:**
   ```bash
   ffmpeg -version
   ```
2. **Check backend logs for FFmpeg errors:**
   ```bash
   pm2 logs ai-call-backend | grep -i ffmpeg
   ```

### Original File Not Replaced on FreePBX
1. **Test SSH connection** in UI (Settings → FreePBX)
2. **Check SSH permissions:**
   ```bash
   ssh root@your-freepbx-ip
   ls -la /var/spool/asterisk/monitor/
   # Should show files owned by asterisk:asterisk
   # Root should have write access
   ```
3. **Check backend logs:**
   ```bash
   pm2 logs ai-call-backend | grep -i "ssh upload"
   ```

### Text Redacted but Audio Still Has Sensitive Data
- This means FFmpeg ran but the time ranges were incorrect
- Check word-level timestamps from Whisper
- Adjust padding in `backend/src/services/pci-redaction.service.js`:
  ```javascript
  static DEFAULT_PADDING = 1.0; // Increase from 0.5 to 1.0 seconds
  ```

### False Positives (Non-Sensitive Data Redacted)
- Adjust keyword detection in `backend/src/services/pci-redaction.service.js`
- Remove overly broad keywords or reduce look-ahead window

---

## 📝 Code Locations

### Backend Services
- **PCI Detection & Audio Muting**: `backend/src/services/pci-redaction.service.js`
- **SSH/SFTP Upload**: `backend/src/services/freepbx-ssh.service.js`
- **Call Processing Orchestration**: `backend/src/services/call-processing.service.js`

### Database Schema
- **Migration**: `backend/src/config/migrations/add-redaction-fields.sql`
- **Table**: `calls` table includes:
  - `redaction_status` VARCHAR(50)
  - `redacted` BOOLEAN
  - `redacted_segments` JSONB
  - `redacted_at` TIMESTAMPTZ

### Frontend
- **SSH Settings UI**: `frontend/app/(dashboard)/settings/freepbx/page.tsx`
- **Type Definitions**: `frontend/types/call.ts`

---

## 🔄 Future Enhancements

Potential improvements for future versions:

1. **DTMF Suppression**: Detect and mute DTMF tones (keypad beeps) as an alternative to speech detection
2. **Multi-language Support**: Extend keyword detection for Spanish, French, etc.
3. **Configurable Padding**: Allow admins to adjust padding per user/org
4. **Redaction Preview**: Show waveform with redacted segments highlighted
5. **Re-redaction**: Allow reprocessing of old calls with updated detection rules
6. **Compliance Reports**: Generate monthly sensitive-data redaction audit logs (PCI + PII/PHI)
7. **Backup Strategy**: Optional encrypted backup of originals before deletion

---

## 📞 Support

For issues or questions about sensitive-data redaction:
1. Check backend logs: `pm2 logs ai-call-backend`
2. Review database redaction status: `SELECT * FROM calls WHERE redacted = true`
3. Test with known phrases: "My credit card number is 1234 5678"
4. Contact system administrator

---

**Last Updated:** December 19, 2025  
**Feature Version:** 1.0  
**Tested On:** FreePBX 16.0.41.1 / Asterisk 16.25.0

