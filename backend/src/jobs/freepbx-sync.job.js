import { FreePbxService } from '../services/freepbx.service.js';
import { Call } from '../models/Call.js';
import { CALL_SOURCE, CALL_STATUS } from '../utils/constants.js';
import { CallProcessingService } from '../services/call-processing.service.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { User } from '../models/User.js';

let schedulerHandle = null;
let lastRun = null;
let inFlight = false;

function getTargetUserId() {
  return config.freepbx.defaultUserId || process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000000';
}

export function getFreePbxSyncStatus() {
  return {
    enabled: FreePbxService.isEnabled(),
    lastRun,
  };
}

export async function runFreePbxSync({ reason = 'manual', userId } = {}) {
  const targetUserId = userId || getTargetUserId();
  const freepbxSettings = await User.getFreePbxSettingsRaw(targetUserId);
  const openaiSettings = await User.getOpenAISettingsRaw(targetUserId);

  if (!FreePbxService.isEnabled(freepbxSettings)) {
    return { synced: 0, skipped: true, reason: 'disabled' };
  }

  if (inFlight) {
    return { synced: 0, skipped: true, reason: 'in-progress' };
  }

  inFlight = true;
  try {
    const latest = await Call.findLatestBySource(targetUserId, CALL_SOURCE.FREEPBX);
    const since = latest?.externalCreatedAt || latest?.createdAt;

    const recordings = await FreePbxService.listRecordings({ since, settings: freepbxSettings });
    let synced = 0;

    for (const recording of recordings) {
      const existing = await Call.findBySourceAndExternalId(CALL_SOURCE.FREEPBX, recording.name);
      if (existing) {
        continue;
      }

      const call = await Call.create({
        userId: targetUserId,
        callSid: `freepbx-${recording.name}`,
        recordingSid: recording.name,
        callerNumber: recording.callerNumber || recording.raw?.['caller_number'] || recording.raw?.['callerid'],
        callerName: recording.raw?.['caller_name'] || recording.raw?.['calleridname'],
        recordingUrl: null,
        recordingPath: recording.name,
        status: CALL_STATUS.PENDING,
        source: CALL_SOURCE.FREEPBX,
        externalId: recording.name,
        externalCreatedAt: recording.createdAt ? recording.createdAt.toISOString() : null,
        sourceMetadata: recording.raw,
        syncedAt: new Date().toISOString(),
        createdAt: recording.createdAt ? recording.createdAt.toISOString() : null,
      });

      try {
        await CallProcessingService.processRecording(call.id, {
          source: CALL_SOURCE.FREEPBX,
          recordingPath: recording.name,
          call,
          freepbxSettings,
          openaiSettings,
        });
        synced += 1;
      } catch (processingError) {
        logger.error({ error: processingError.message, callId: call.id }, 'Failed to process FreePBX recording');
      }
    }

    lastRun = {
      at: new Date().toISOString(),
      synced,
      reason,
    };

    return { synced, reason };
  } catch (error) {
    logger.error({ error: error.message }, 'FreePBX sync failed');
    lastRun = {
      at: new Date().toISOString(),
      error: error.message,
      reason,
    };
    throw error;
  } finally {
    inFlight = false;
  }
}

export function scheduleFreePbxSync() {
  if (!FreePbxService.isEnabled()) {
    return;
  }

  if (schedulerHandle) {
    return;
  }

  const intervalMinutes = config.freepbx.syncIntervalMinutes || 10;
  const intervalMs = intervalMinutes * 60 * 1000;

  schedulerHandle = setInterval(() => {
    runFreePbxSync({ reason: 'scheduled' }).catch((error) => {
      logger.error({ error: error.message }, 'Scheduled FreePBX sync failed');
    });
  }, intervalMs);

  logger.info({ intervalMinutes }, 'Scheduled FreePBX sync job');
}

