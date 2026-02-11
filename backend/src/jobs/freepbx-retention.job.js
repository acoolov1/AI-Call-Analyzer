import { logger } from '../utils/logger.js';
import { query } from '../config/database.js';
import { User } from '../models/User.js';
import { FreePbxSshService } from '../services/freepbx-ssh.service.js';
import { CALL_SOURCE } from '../utils/constants.js';
import { DateTime } from 'luxon';
import { computeNextRunAtUtcISO, normalizeDailyHHMM } from '../utils/retention-schedule.js';

let schedulerHandle = null;
let tickInFlight = false;
let activeCount = 0;

const DEFAULT_MAX_CONCURRENT = 1;

function getMaxConcurrent() {
  const raw = process.env.FREEPBX_RETENTION_MAX_CONCURRENT;
  const n = raw ? Number.parseInt(String(raw), 10) : DEFAULT_MAX_CONCURRENT;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_CONCURRENT;
  return Math.min(n, 5);
}

async function markCallsRecordingDeleted({ userId, cutoffIso }) {
  // Mark recordings as deleted in our DB so UI can show "Recording auto deleted".
  // We only touch FreePBX CDR calls with an existing recording_path.
  const result = await query(
    `
    UPDATE calls
    SET recording_path = NULL,
        recording_deleted_at = NOW(),
        recording_deleted_reason = 'retention',
        updated_at = NOW()
    WHERE user_id = $1
      AND source = $2
      AND recording_path IS NOT NULL
      AND COALESCE(external_created_at, created_at) < $3::timestamptz
    `,
    [userId, CALL_SOURCE.FREEPBX_CDR, cutoffIso]
  );
  return result.rowCount || 0;
}

export async function runFreePbxRetentionTick() {
  if (tickInFlight) return;
  tickInFlight = true;

  try {
    const maxConcurrent = getMaxConcurrent();
    if (activeCount >= maxConcurrent) return;

    // Pick a small batch of due users; we’ll run up to available concurrency slots.
    const slots = Math.max(maxConcurrent - activeCount, 0);
    if (!slots) return;

    const due = await query(
      `
      SELECT id, email, timezone, freepbx_settings
      FROM users
      WHERE freepbx_settings IS NOT NULL
        AND COALESCE((freepbx_settings->>'retention_enabled')::boolean, false) = true
        AND (freepbx_settings->>'retention_next_run_at') IS NOT NULL
        AND (freepbx_settings->>'retention_next_run_at')::timestamptz <= NOW()
      ORDER BY (freepbx_settings->>'retention_next_run_at')::timestamptz ASC
      LIMIT $1
      `,
      [Math.max(slots, 1)]
    );

    for (const row of due.rows) {
      if (activeCount >= maxConcurrent) break;
      activeCount += 1;

      // Run sequentially by awaiting; still respects maxConcurrent if you later add parallelism.
      try {
        await runRetentionForUser(row);
      } catch (e) {
        // Errors are recorded per user; just continue.
      } finally {
        activeCount -= 1;
      }
    }
  } finally {
    tickInFlight = false;
  }
}

async function runRetentionForUser(row) {
  const userId = row.id;
  const email = row.email;
  const timezone = row.timezone || 'UTC';
  const freepbxSettings = row.freepbx_settings || {};

  const retentionEnabled = Boolean(freepbxSettings.retention_enabled);
  if (!retentionEnabled) return;

  const retentionDays = Number.parseInt(String(freepbxSettings.retention_days ?? 30), 10);
  const runTime = normalizeDailyHHMM(freepbxSettings.retention_run_time ?? '02:00', '02:00');

  const hasSshCreds =
    freepbxSettings?.ssh_host &&
    freepbxSettings?.ssh_username &&
    (freepbxSettings?.ssh_password || freepbxSettings?.ssh_private_key);

  if (!hasSshCreds) {
    const nextRunAt = computeNextRunAtUtcISO({ timezone, hhmm: runTime });
    await User.mergeFreePbxSettings(userId, {
      retention_last_run_at: new Date().toISOString(),
      retention_last_result: { ok: false, error: 'SSH credentials missing' },
      retention_next_run_at: nextRunAt,
    });
    return;
  }

  const startedAt = new Date();
  logger.info({ userId, email, retentionDays, runTime, timezone }, 'Starting FreePBX retention run');

  try {
    const delResult = await FreePbxSshService.deleteOldRecordingsByDays(freepbxSettings, retentionDays, { timezone });

    // Mark affected calls in our DB (best-effort UX improvement), but only if we actually deleted anything.
    // This avoids showing "auto deleted" when nothing was removed on the PBX (e.g., boundary day).
    let marked = 0;
    if ((delResult?.candidateFiles || 0) > 0) {
      const cutoff = DateTime.now()
        .setZone(timezone)
        .startOf('day')
        .minus({ days: retentionDays - 1 })
        .toUTC()
        .toISO();
      marked = await markCallsRecordingDeleted({ userId, cutoffIso: cutoff });
    }

    const nextRunAt = computeNextRunAtUtcISO({ timezone, hhmm: runTime, now: startedAt });

    await User.mergeFreePbxSettings(userId, {
      retention_last_run_at: startedAt.toISOString(),
      retention_last_result: {
        ok: true,
        candidateFiles: delResult.candidateFiles,
        markedCalls: marked,
        retentionDays,
        basePath: delResult.basePath,
        keepFromYmdPath: delResult.keepFromYmdPath,
      },
      retention_next_run_at: nextRunAt,
    });

    logger.info(
      { userId, email, candidateFiles: delResult.candidateFiles, markedCalls: marked },
      'FreePBX retention run completed'
    );
  } catch (error) {
    const nextRunAt = computeNextRunAtUtcISO({ timezone, hhmm: runTime, now: startedAt });
    await User.mergeFreePbxSettings(userId, {
      retention_last_run_at: startedAt.toISOString(),
      retention_last_result: { ok: false, error: error?.message || String(error) },
      retention_next_run_at: nextRunAt,
    });
    logger.error({ userId, email, error: error?.message }, 'FreePBX retention run failed');
  }
}

export function scheduleFreePbxRetention() {
  if (schedulerHandle) return;

  // Wake up often, but only execute due users; each user is once/day.
  schedulerHandle = setInterval(() => {
    runFreePbxRetentionTick().catch((err) => {
      logger.error({ error: err?.message || String(err) }, 'FreePBX retention tick failed');
    });
  }, 60 * 1000);

  logger.info(
    { maxConcurrent: getMaxConcurrent() },
    'Scheduled FreePBX retention tick (once/day per user)'
  );

  // Trigger an immediate tick so near-term test schedules work.
  runFreePbxRetentionTick().catch((err) => {
    logger.error({ error: err?.message || String(err) }, 'Initial FreePBX retention tick failed');
  });
}

