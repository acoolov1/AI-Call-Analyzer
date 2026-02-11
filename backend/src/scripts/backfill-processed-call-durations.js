/**
 * Backfill calls.duration for already-processed FreePBX CDR calls.
 *
 * Strategy: group by user, create one SFTP connection per user, range-read a small header window
 * (first 64KB) from each recording, parse WAV duration, and update calls.duration.
 *
 * Usage:
 *   node src/scripts/backfill-processed-call-durations.js --limit 500 --concurrencyUsers 1
 */
import SftpClient from 'ssh2-sftp-client';
import { getPool, query } from '../config/database.js';
import { User } from '../models/User.js';
import { FreePbxSshService } from '../services/freepbx-ssh.service.js';
import { parseWavDurationSeconds, wavDurationSecondsToBillingSeconds } from '../utils/wav-duration.js';
import { CALL_SOURCE } from '../utils/constants.js';

function getArg(name, fallback = null) {
  const idx = process.argv.findIndex((a) => a === `--${name}`);
  if (idx === -1) return fallback;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith('--')) return true;
  return next;
}

const LIMIT = Number.parseInt(String(getArg('limit', '500')), 10) || 500;
const HEADER_BYTES = Number.parseInt(String(getArg('headerBytes', '65536')), 10) || 65536;

// Initialize DB pool for `query()` helper.
getPool();

async function readHeaderBytes(sftp, remotePath, maxBytes) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const stream = sftp.createReadStream(remotePath, { start: 0, end: maxBytes - 1 });

    const cleanup = () => {
      try {
        stream.destroy();
      } catch {}
    };

    stream.on('data', (chunk) => {
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(b);
      total += b.length;
      if (total >= maxBytes) {
        cleanup();
        resolve(Buffer.concat(chunks, Math.min(total, maxBytes)));
      }
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

async function backfillUser(userId, calls) {
  const freepbxSettings = await User.getFreePbxSettingsRaw(userId);
  if (!freepbxSettings?.ssh_host || !freepbxSettings?.ssh_username || (!freepbxSettings?.ssh_password && !freepbxSettings?.ssh_private_key)) {
    console.log(`Skipping user ${userId}: missing SSH settings`);
    return { updated: 0, errors: calls.length };
  }

  const sftp = new SftpClient(`backfill-duration-${userId}`);
  const sshConfig = FreePbxSshService.getSshConfig(freepbxSettings);
  await sftp.connect(sshConfig);

  let updated = 0;
  let errors = 0;
  let logged = 0;
  try {
    for (const c of calls) {
      const recordingRef = c.recording_path || c.recording_url;
      if (!recordingRef) {
        errors += 1;
        continue;
      }
      const remotePath = FreePbxSshService.resolveRemotePath(recordingRef, freepbxSettings);
      try {
        const header = await readHeaderBytes(sftp, remotePath, HEADER_BYTES);
        const parsed = parseWavDurationSeconds(header);
        const billingSeconds = wavDurationSecondsToBillingSeconds(parsed);
        if (!billingSeconds || billingSeconds <= 0) {
          if (logged < 3) {
            console.log(`WARN: unable to parse WAV header`, { userId, callId: c.id, recordingRef, remotePath });
            logged += 1;
          }
          errors += 1;
          continue;
        }
        await query('UPDATE calls SET duration = $1, updated_at = NOW() WHERE id = $2', [billingSeconds, c.id]);
        updated += 1;
      } catch (e) {
        if (logged < 3) {
          console.log(`WARN: failed to read header`, {
            userId,
            callId: c.id,
            recordingRef,
            remotePath,
            error: e?.message || String(e),
          });
          logged += 1;
        }
        errors += 1;
      }
    }
  } finally {
    await sftp.end().catch(() => {});
  }
  return { updated, errors };
}

async function main() {
  const rows = await query(
    `
    SELECT id, user_id, recording_path, recording_url
    FROM calls
    WHERE source = $1
      AND processed_at IS NOT NULL
      AND (duration IS NULL OR duration <= 0)
      AND (recording_path IS NOT NULL OR recording_url IS NOT NULL)
    ORDER BY processed_at DESC
    LIMIT $2
    `,
    [CALL_SOURCE.FREEPBX_CDR, LIMIT]
  );

  const calls = rows.rows || [];
  console.log(`Found ${calls.length} processed calls missing duration (limit ${LIMIT}).`);
  if (calls.length === 0) return;

  const byUser = new Map();
  for (const c of calls) {
    const userId = c.user_id;
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId).push(c);
  }

  let totalUpdated = 0;
  let totalErrors = 0;
  for (const [userId, userCalls] of byUser.entries()) {
    console.log(`Backfilling user ${userId}: ${userCalls.length} calls...`);
    const res = await backfillUser(userId, userCalls);
    totalUpdated += res.updated;
    totalErrors += res.errors;
    console.log(`User ${userId}: updated ${res.updated}, errors ${res.errors}`);
  }

  console.log(`Done. Updated ${totalUpdated} calls. Errors ${totalErrors}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

