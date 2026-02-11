import { logger } from '../utils/logger.js';
import { query } from '../config/database.js';
import { User } from '../models/User.js';
import { VoicemailMessage, VOICEMAIL_STATUS } from '../models/VoicemailMessage.js';
import { FreePbxVoicemailService } from '../services/freepbx-voicemail.service.js';
import { VoicemailProcessingService } from '../services/voicemail-processing.service.js';

let syncHandle = null;
let processingHandle = null;
let syncTickInFlight = false;
let processingTickInFlight = false;

const DEFAULT_MAX_CONCURRENT = 1;
let activeSync = 0;
let activeProcessing = 0;
const activeUserSyncIds = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getMaxConcurrent() {
  const raw = process.env.FREEPBX_VOICEMAIL_MAX_CONCURRENT;
  const n = raw ? Number.parseInt(String(raw), 10) : DEFAULT_MAX_CONCURRENT;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_CONCURRENT;
  return Math.min(n, 3);
}

function computeNextSyncAt({ intervalMinutes }) {
  const mins = Number.parseInt(String(intervalMinutes || 5), 10);
  const clamped = Number.isFinite(mins) && mins >= 1 && mins <= 1440 ? mins : 5;
  return new Date(Date.now() + clamped * 60 * 1000).toISOString();
}

async function doSyncForUser(row, { reason = 'scheduled' } = {}) {
  const userId = row.id;
  const email = row.email;
  const timezone = row.timezone || 'UTC';
  const settings = row.freepbx_settings || {};

  if (activeUserSyncIds.has(userId)) {
    logger.info({ userId, email, reason }, 'Skipping voicemail sync (already in progress for user)');
    return { skipped: true, reason: 'in-progress' };
  }
  activeUserSyncIds.add(userId);

  const intervalMinutes = settings.voicemail_sync_interval_minutes ?? 5;
  const startedAt = new Date();
  logger.info({ userId, email, reason }, 'Starting FreePBX voicemail sync');

  try {
    // Mark in-progress for UI visibility
    await User.mergeFreePbxSettings(userId, {
      voicemail_sync_in_progress: true,
      voicemail_sync_started_at: startedAt.toISOString(),
    }).catch(() => {});

    const mailboxes = await FreePbxVoicemailService.listMailboxes(settings);
    let upserted = 0;

    const { context: vmContext, folders } = FreePbxVoicemailService.getVoicemailConfig(settings);

    const buildPbxIdentity = (msg) => {
      // Best-effort stable identity: mailbox+origtime+duration+callerId (folder/msgId can change).
      const ot = msg?.receivedAt ? new Date(msg.receivedAt).getTime() : 0;
      const secs = Number(msg?.durationSeconds || 0) || 0;
      const cid = String(msg?.callerId || '').trim();
      return `${String(msg?.mailbox || '')}|${ot}|${secs}|${cid}`;
    };

    for (const mb of mailboxes) {
      const messages = await FreePbxVoicemailService.listMessagesForMailbox(settings, { mailbox: mb.mailbox });
      for (const msg of messages) {
        await VoicemailMessage.upsertDiscovery({
          userId,
          mailbox: msg.mailbox,
          vmContext: msg.vmContext,
          folder: msg.folder,
          msgId: msg.msgId,
          receivedAt: msg.receivedAt,
          callerId: msg.callerId,
          durationSeconds: msg.durationSeconds,
          recordingPath: msg.recordingPath,
          metadataPath: msg.metadataPath,
          pbxIdentity: buildPbxIdentity(msg),
        });
        upserted += 1;
      }
    }

    // Reconcile deletions: anything not seen in this sync run is gone on PBX -> hard-delete DB row.
    // Uses last_seen_at, which is updated only by discovery upserts.
    const deletedRes = await query(
      `
      DELETE FROM voicemail_messages
      WHERE user_id = $1
        AND vm_context = $2
        AND folder = ANY($3::text[])
        AND (last_seen_at IS NULL OR last_seen_at < $4::timestamptz)
      `,
      [userId, String(vmContext), Array.isArray(folders) ? folders.map(String) : ['INBOX', 'Old'], startedAt.toISOString()]
    );
    const deleted = deletedRes?.rowCount || 0;

    const nextSyncAt = computeNextSyncAt({ intervalMinutes });
    await User.mergeFreePbxSettings(userId, {
      voicemail_last_sync_at: startedAt.toISOString(),
      voicemail_next_sync_at: nextSyncAt,
      voicemail_last_result: {
        ok: true,
        upserted,
        mailboxCount: mailboxes.length,
        deleted,
        timezone,
        reason,
      },
      voicemail_sync_in_progress: false,
      voicemail_sync_started_at: null,
    });

    logger.info({ userId, email, upserted, mailboxCount: mailboxes.length }, 'FreePBX voicemail sync completed');
    return { ok: true, upserted, mailboxCount: mailboxes.length };
  } catch (error) {
    const nextSyncAt = computeNextSyncAt({ intervalMinutes });
    await User.mergeFreePbxSettings(userId, {
      voicemail_last_sync_at: startedAt.toISOString(),
      voicemail_next_sync_at: nextSyncAt,
      voicemail_last_result: { ok: false, error: error?.message || String(error), reason },
      voicemail_sync_in_progress: false,
      voicemail_sync_started_at: null,
    }).catch(() => {});
    logger.error({ userId, email, error: error?.message }, 'FreePBX voicemail sync failed');
    return { ok: false, error: error?.message || String(error) };
  } finally {
    activeUserSyncIds.delete(userId);
  }
}

async function getUserRowById(userId) {
  const result = await query(
    `
    SELECT id, email, timezone, freepbx_settings
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );
  return result.rows[0] || null;
}

// Manual “Sync now” trigger (async). Respects max concurrent across users.
export async function runFreePbxVoicemailSyncNowForUserId(userId, { reason = 'manual' } = {}) {
  const maxConcurrent = getMaxConcurrent();
  // Wait for a slot (no random delays; strictly sequential if maxConcurrent=1).
  while (activeSync >= maxConcurrent) {
    await sleep(500);
  }
  activeSync += 1;
  try {
    const row = await getUserRowById(userId);
    if (!row) return { ok: false, error: 'User not found' };
    return await doSyncForUser(row, { reason });
  } finally {
    activeSync -= 1;
  }
}

export async function runFreePbxVoicemailSyncTick() {
  if (syncTickInFlight) return;
  syncTickInFlight = true;

  try {
    const maxConcurrent = getMaxConcurrent();
    if (activeSync >= maxConcurrent) return;

    const slots = Math.max(maxConcurrent - activeSync, 0);
    if (!slots) return;

    const due = await query(
      `
      SELECT id, email, timezone, freepbx_settings
      FROM users
      WHERE freepbx_settings IS NOT NULL
        AND COALESCE((freepbx_settings->>'voicemail_enabled')::boolean, false) = true
        AND (freepbx_settings->>'ssh_host') IS NOT NULL
        AND (freepbx_settings->>'ssh_username') IS NOT NULL
        AND (
          (freepbx_settings->>'ssh_password') IS NOT NULL
          OR (freepbx_settings->>'ssh_private_key') IS NOT NULL
        )
        AND (
          (freepbx_settings->>'voicemail_next_sync_at') IS NULL
          OR (freepbx_settings->>'voicemail_next_sync_at')::timestamptz <= NOW()
        )
      ORDER BY COALESCE((freepbx_settings->>'voicemail_next_sync_at')::timestamptz, NOW()) ASC
      LIMIT $1
      `,
      [Math.max(slots, 1)]
    );

    for (const row of due.rows) {
      if (activeSync >= maxConcurrent) break;
      activeSync += 1;
      try {
        await doSyncForUser(row, { reason: 'scheduled' });
      } finally {
        activeSync -= 1;
      }
    }
  } finally {
    syncTickInFlight = false;
  }
}

async function runProcessingOnce() {
  const result = await query(
    `
    SELECT id, user_id
    FROM voicemail_messages
    WHERE status = $1
      AND recording_path IS NOT NULL
    ORDER BY received_at ASC NULLS LAST, created_at ASC
    LIMIT 1
    `,
    [VOICEMAIL_STATUS.PENDING]
  );

  const row = result.rows[0];
  if (!row) return false;

  const userId = row.user_id;
  const id = row.id;
  const freepbxSettings = await User.getFreePbxSettingsRaw(userId);

  // Mark processing before doing heavy work
  await VoicemailMessage.update(id, userId, { status: VOICEMAIL_STATUS.PROCESSING }).catch(() => {});
  await VoicemailProcessingService.processVoicemailMessage({ id, userId, freepbxSettings });
  return true;
}

export async function runVoicemailProcessingTick() {
  if (processingTickInFlight) return;
  processingTickInFlight = true;
  try {
    const maxConcurrent = getMaxConcurrent();
    if (activeProcessing >= maxConcurrent) return;
    activeProcessing += 1;
    try {
      await runProcessingOnce();
    } finally {
      activeProcessing -= 1;
    }
  } finally {
    processingTickInFlight = false;
  }
}

export function scheduleFreePbxVoicemailJobs() {
  if (!syncHandle) {
    // Wake up often; per-user cadence is controlled by voicemail_next_sync_at.
    syncHandle = setInterval(() => {
      runFreePbxVoicemailSyncTick().catch((err) => {
        logger.error({ error: err?.message || String(err) }, 'FreePBX voicemail sync tick failed');
      });
    }, 60 * 1000);
    logger.info({ maxConcurrent: getMaxConcurrent() }, 'Scheduled FreePBX voicemail sync tick');
    runFreePbxVoicemailSyncTick().catch(() => {});
  }

  if (!processingHandle) {
    processingHandle = setInterval(() => {
      runVoicemailProcessingTick().catch((err) => {
        logger.error({ error: err?.message || String(err) }, 'Voicemail processing tick failed');
      });
    }, 30 * 1000);
    logger.info({ maxConcurrent: getMaxConcurrent() }, 'Scheduled voicemail processing tick');
    runVoicemailProcessingTick().catch(() => {});
  }
}

