import { FreePbxCdrService } from '../services/freepbx-cdr.service.js';
import { Call } from '../models/Call.js';
import { CALL_SOURCE, CALL_STATUS } from '../utils/constants.js';
import { CallProcessingService } from '../services/call-processing.service.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { User } from '../models/User.js';
import { FreepbxExtensionDirectory } from '../models/FreepbxExtensionDirectory.js';

let schedulerHandle = null;
let lastRuns = {}; // Track last 3 syncs per user
let inFlight = false;

export function getFreePbxCdrSyncStatus() {
  return {
    enabled: true,
    lastRuns: lastRuns,
  };
}

export async function runFreePbxCdrSync({ reason = 'manual', userId } = {}) {
  // If a specific userId is provided (manual sync), sync only that user
  if (userId) {
    return await syncUserCdrRecords(userId, reason);
  }

  // Otherwise, sync all users with FreePBX enabled
  if (inFlight) {
    logger.info('FreePBX CDR sync already in progress, skipping');
    return { synced: 0, skipped: true, reason: 'in-progress' };
  }

  inFlight = true;
  let totalSynced = 0;
  const syncResults = [];
  
  try {
    // Get all users from database
    const { getPool } = await import('../config/database.js');
    const pool = getPool();
    const result = await pool.query(`
      SELECT id, email, freepbx_settings 
      FROM users 
      WHERE freepbx_settings IS NOT NULL
    `);

    logger.info(`Starting multi-user FreePBX CDR sync for ${result.rows.length} users with settings`);

    // Sync users sequentially to avoid overwhelming the database pool
    for (const user of result.rows) {
      const settings = user.freepbx_settings;
      
      // Check if FreePBX is enabled for this user
      if (!FreePbxCdrService.isEnabled(settings)) {
        logger.info(`Skipping user ${user.email}: FreePBX not enabled or not configured`);
        continue;
      }
      
      logger.info(`Syncing FreePBX CDR for user: ${user.email}`);
      try {
        const syncResult = await syncUserCdrRecords(user.id, reason);
        totalSynced += syncResult.synced || 0;
        syncResults.push({
          userId: user.id,
          email: user.email,
          ...syncResult
        });
        logger.info(`Completed sync for ${user.email}: ${syncResult.synced} records synced`);
      } catch (error) {
        logger.error({ error: error.message, userId: user.id, email: user.email }, 'Failed to sync user CDR records');
        syncResults.push({
          userId: user.id,
          email: user.email,
          error: error.message,
          synced: 0
        });
      }
    }

    logger.info(`FreePBX CDR sync completed: ${totalSynced} total records synced across ${syncResults.length} users`);
    
    return { 
      synced: totalSynced, 
      reason,
      users: syncResults.length,
      results: syncResults
    };
  } catch (error) {
    logger.error({ error: error.message }, 'FreePBX CDR multi-user sync failed');
    throw error;
  } finally {
    inFlight = false;
  }
}

async function syncUserCdrRecords(userId, reason) {
  const freepbxSettings = await User.getFreePbxSettingsRaw(userId);
  
  // Get OpenAI settings: uses admin's API key + user's custom prompt
  const { OpenAIService } = await import('../services/openai.service.js');
  const openaiSettings = await OpenAIService.getSettingsForUser(userId);
  
  // Get user's timezone preference
  const user = await User.findById(userId);
  const userTimezone = user?.timezone || 'America/New_York';

  if (!FreePbxCdrService.isEnabled(freepbxSettings)) {
    return { synced: 0, skipped: true, reason: 'disabled' };
  }

  try {
    // Get the latest CDR-sourced call to determine where to sync from
    const latest = await Call.findLatestBySource(userId, CALL_SOURCE.FREEPBX_CDR);
    let since = latest?.externalCreatedAt || latest?.createdAt;

    // Safety lookback: FreePBX CDR can emit multiple legs per uniqueid, and late-arriving
    // "better" legs (ANSWERED/recordingfile) may share the same calldate window. A small
    // lookback ensures we can correct recent calls without a historical backfill.
    const LOOKBACK_MINUTES = 360; // 6 hours
    if (since) {
      const sinceDate = new Date(since);
      if (!Number.isNaN(sinceDate.getTime())) {
        since = new Date(sinceDate.getTime() - LOOKBACK_MINUTES * 60 * 1000).toISOString();
      }
    }
    
    // If no existing calls and integration_date is set, use that as the starting point
    // This prevents syncing hundreds of old calls when first setting up FreePBX
    if (!since && freepbxSettings.integration_date) {
      since = freepbxSettings.integration_date;
      logger.info({ userId, integrationDate: since }, 'Using integration date as starting point for first sync');
    }

    const cdrRecords = await FreePbxCdrService.listCdrRecords({ 
      since, 
      limit: 1000,
      freepbxSettings,
      userTimezone 
    });

    // Cached extension directory (DB) for fast name lookups during ingest.
    const extNameMap = await FreepbxExtensionDirectory.getMapByUserId(userId);
    
    console.log(`📋 Found ${cdrRecords.length} CDR records to process for user ${userId}`);
    console.log(`📅 Syncing calls since: ${since || 'beginning of time'}`);
    
    let synced = 0;

    const isInternalExtension = (value) => {
      const s = String(value || '').trim();
      return /^\d{3,4}$/.test(s);
    };

    const parseAnsweredExtensionFromDstChannel = (dstchannel) => {
      const s = String(dstchannel || '').trim();
      if (!s) return null;
      const m = s.match(/(?:PJSIP|SIP)\/(\d{3,4})(?:-|$)/i);
      return m?.[1] ? String(m[1]).trim() : null;
    };

    const computeDirection = (rawCdr) => {
      const normalize = (v) => String(v ?? '').trim();

      const answeredExt = parseAnsweredExtensionFromDstChannel(rawCdr?.dstchannel);

      // Prefer cnum (often the internal extension) over src (can be rewritten to trunk)
      const srcCandidate = isInternalExtension(rawCdr?.cnum) ? rawCdr?.cnum : rawCdr?.src;
      const dstCandidate = answeredExt || rawCdr?.dst;

      const src = normalize(srcCandidate);
      const dst = normalize(dstCandidate);
      const did = String(rawCdr?.did || '').trim();
      const dcontext = String(rawCdr?.dcontext || '').trim().toLowerCase();

      const isExtension = (value) => {
        const s = normalize(value);
        if (!s) return false;
        // Prefer the directory map when available (most accurate)
        if (extNameMap && typeof extNameMap.size === 'number' && extNameMap.size > 0) {
          return extNameMap.has(s);
        }
        return isInternalExtension(s);
      };

      const srcExt = isExtension(src);
      const dstExt = isExtension(dst);

      // Internal: extension -> extension
      if (srcExt && dstExt) return 'internal';

      // Outbound: internal extension -> external destination
      if (srcExt && !dstExt) return 'outbound';

      // Inbound: external source -> internal extension, OR external source hitting a DID/ring group/queue context
      if (!srcExt) {
        if (dstExt) return 'inbound';
        if (did) return 'inbound'; // main DID calls often land on ring groups where dst = 0
        if (dcontext.startsWith('from-trunk') || dcontext.startsWith('ext-')) return 'inbound';
      }

      return null; // internal↔internal or ambiguous
    };

    for (const cdrRecord of cdrRecords) {
      const disposition = String(cdrRecord.disposition || cdrRecord.rawCdr?.disposition || '').trim();
      const isAnswered = disposition.toUpperCase() === 'ANSWERED';
      const hasRecordingFile = Boolean(String(cdrRecord.recordingfile || '').trim());
      const answeredExtension = parseAnsweredExtensionFromDstChannel(cdrRecord.rawCdr?.dstchannel);
      const answeredName = answeredExtension ? extNameMap.get(answeredExtension) || null : null;

      // Check if this CDR record already exists by external_id
      const existingByExternalId = await Call.findBySourceAndExternalId(
        CALL_SOURCE.FREEPBX_CDR, 
        cdrRecord.uniqueid
      );
      
      if (existingByExternalId) {
        // If we previously ingested a weaker leg (e.g., NO ANSWER) but we now see an
        // ANSWERED leg with a recording, upgrade the call and process it.
        if (isAnswered && hasRecordingFile) {
          const existingLooksUnprocessed =
            !existingByExternalId.transcript ||
            !existingByExternalId.analysis ||
            String(existingByExternalId.analysis || '').includes('Unanswered call') ||
            !String(existingByExternalId.recordingPath || '').trim();

          if (existingLooksUnprocessed) {
            const direction = computeDirection(cdrRecord.rawCdr);
            const updated = await Call.update(existingByExternalId.id, null, {
              status: CALL_STATUS.PENDING,
              recordingPath: cdrRecord.recordingfile,
              analysis: null,
              transcript: null,
              sourceMetadata: {
                ...(cdrRecord.rawCdr || {}),
                answered_extension: answeredExtension,
                answered_name: answeredName,
              },
              direction,
            });

            try {
              await CallProcessingService.processRecording(updated.id, {
                source: CALL_SOURCE.FREEPBX_CDR,
                recordingPath: cdrRecord.recordingfile,
                call: updated,
                freepbxSettings,
                openaiSettings,
              });
              synced += 1;
            } catch (processingError) {
              logger.error(
                { error: processingError.message, callId: updated.id, recordingFile: cdrRecord.recordingfile },
                'Failed to process upgraded FreePBX CDR recording'
              );
            }
          }
          console.log(`⏭️  Skipping existing call (external_id): ${cdrRecord.uniqueid}`);
          continue;
        }

        // Repair previously-ingested non-answered calls that had "recording_path" set
        // (FreePBX can populate recordingfile even when the call wasn't answered).
        if (!isAnswered) {
          const shouldRepairAnalysis =
            !existingByExternalId.analysis || !String(existingByExternalId.analysis).includes('2. Summary');
          const hasRecordingPath = Boolean(String(existingByExternalId.recordingPath || '').trim());
          const direction = computeDirection(existingByExternalId.sourceMetadata || {});
          const repairAnsweredExtension = parseAnsweredExtensionFromDstChannel(existingByExternalId.sourceMetadata?.dstchannel);
          const repairAnsweredName = repairAnsweredExtension ? extNameMap.get(repairAnsweredExtension) || null : null;

          if (shouldRepairAnalysis || hasRecordingPath || existingByExternalId.status !== CALL_STATUS.COMPLETED) {
            const repairedAnalysis = `2. Summary\nUnanswered call`;
            await Call.update(existingByExternalId.id, null, {
              status: CALL_STATUS.COMPLETED,
              analysis: repairedAnalysis,
              recordingPath: null,
              sourceMetadata: {
                ...(existingByExternalId.sourceMetadata || {}),
                answered_extension: repairAnsweredExtension,
                answered_name: repairAnsweredName,
              },
              direction,
            });
          }
        }
        console.log(`⏭️  Skipping existing call (external_id): ${cdrRecord.uniqueid}`);
        continue;
      }
      
      // Also check by call_sid to be extra safe
      const callSid = `freepbx-cdr-${cdrRecord.uniqueid}`;
      const existingByCallSid = await Call.findByCallSid(callSid);
      
      if (existingByCallSid) {
        console.log(`⏭️  Skipping existing call (call_sid): ${callSid}`);
        continue;
      }
      
      console.log(`✨ Creating new call: ${cdrRecord.uniqueid} from ${cdrRecord.callerNumber}`);

      // Create call record from CDR
      // CDR calldate is in user's local timezone, we need to convert to UTC properly
      let isoCallDate = null;
      if (cdrRecord.calldate) {
        try {
          // Get the user's timezone offset
          const { FreePbxCdrService } = await import('../services/freepbx-cdr.service.js');
          const tzOffset = FreePbxCdrService.getTimezoneOffset(userTimezone); // Hours from UTC (negative for US timezones)
          
          // FreePBX stores as 'YYYY-MM-DD HH:MM:SS' in local time
          // Parse the components manually to avoid timezone confusion
          // Example: '2025-11-25 14:45:03' in EST (offset -5) -> should become '2025-11-25T19:45:03.000Z' UTC
          const calldate = cdrRecord.calldate.toString();
          const parts = calldate.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
          
          if (parts) {
            // Parse as UTC components, then adjust for timezone
            // Date.UTC creates a timestamp treating the components as UTC
            const utcTimestamp = Date.UTC(
              parseInt(parts[1]), // year
              parseInt(parts[2]) - 1, // month (0-indexed)
              parseInt(parts[3]), // day
              parseInt(parts[4]), // hour
              parseInt(parts[5]), // minute
              parseInt(parts[6])  // second
            );
            
            // Now adjust: the timestamp above treats "14:45" as UTC, but it's actually in user's timezone
            // So we need to subtract the offset to get the true UTC time
            // If offset is -5 (EST), subtracting -5 means adding 5 hours
            const adjustedTimestamp = utcTimestamp - (tzOffset * 60 * 60 * 1000);
            isoCallDate = new Date(adjustedTimestamp).toISOString();
            
            console.log(`🕐 Converted ${calldate} (${userTimezone}, offset ${tzOffset}) -> ${isoCallDate} (UTC)`);
          } else {
            throw new Error('Invalid date format');
          }
        } catch (e) {
          console.error('Failed to parse CDR calldate:', cdrRecord.calldate, e.message);
          // Fallback to original parsing
          isoCallDate = new Date(cdrRecord.calldate).toISOString();
        }
      }
      
      // Try to create the call record
      let call;
      try {
        const direction = computeDirection(cdrRecord.rawCdr);
        call = await Call.create({
          userId: userId,
          callSid: `freepbx-cdr-${cdrRecord.uniqueid}`,
          recordingSid: cdrRecord.uniqueid,
          callerNumber: cdrRecord.callerNumber,
          callerName: cdrRecord.callerName,
          recordingUrl: null,
          // FreePBX can populate recordingfile even for NO ANSWER/BUSY/FAILED calls.
          // We treat non-ANSWERED calls as "no recording" and do not attempt processing.
          recordingPath: isAnswered ? (cdrRecord.recordingfile || null) : null,
          status: isAnswered && cdrRecord.recordingfile ? CALL_STATUS.PENDING : CALL_STATUS.COMPLETED,
          source: CALL_SOURCE.FREEPBX_CDR,
          externalId: cdrRecord.uniqueid,
          externalCreatedAt: isoCallDate,
          sourceMetadata: {
            ...(cdrRecord.rawCdr || {}),
            answered_extension: answeredExtension,
            answered_name: answeredName,
          },
          direction,
          syncedAt: new Date().toISOString(),
          createdAt: isoCallDate,
        });
      } catch (createError) {
        // If duplicate key error, skip this record gracefully
        if (createError.message && createError.message.includes('duplicate key')) {
          console.log(`⚠️  Duplicate call detected during insert: ${cdrRecord.uniqueid} (${createError.message})`);
          continue;
        }
        // For other errors, re-throw
        throw createError;
      }

      // Only process recording if one exists
      if (isAnswered && hasRecordingFile) {
        try {
          await CallProcessingService.processRecording(call.id, {
            source: CALL_SOURCE.FREEPBX_CDR,
            recordingPath: cdrRecord.recordingfile,
            call,
            freepbxSettings,
            openaiSettings,
          });
          synced += 1;
        } catch (processingError) {
          logger.error({ 
            error: processingError.message, 
            callId: call.id,
            recordingFile: cdrRecord.recordingfile 
          }, 'Failed to process FreePBX CDR recording');
        }
      } else {
        // No recording (or not answered) - mark as completed without processing
        const analysis = isAnswered
          ? 'No recording available for this call'
          : `2. Summary\nUnanswered call`;

        await Call.update(call.id, null, {
          status: CALL_STATUS.COMPLETED,
          analysis,
          recordingPath: isAnswered ? (cdrRecord.recordingfile || null) : null,
        });
        synced += 1;
      }
    }

    const syncResult = {
      at: new Date().toISOString(),
      synced,
      reason,
      userId,
    };
    
    // Track last 3 runs per user
    if (!lastRuns[userId]) {
      lastRuns[userId] = [];
    }
    lastRuns[userId].unshift(syncResult);
    if (lastRuns[userId].length > 3) {
      lastRuns[userId] = lastRuns[userId].slice(0, 3);
    }

    return { synced, reason };
  } catch (error) {
    logger.error({ error: error.message, userId }, 'FreePBX CDR sync failed for user');
    const syncResult = {
      at: new Date().toISOString(),
      error: error.message,
      reason,
      synced: 0,
      userId,
    };
    
    // Track last 3 runs per user
    if (!lastRuns[userId]) {
      lastRuns[userId] = [];
    }
    lastRuns[userId].unshift(syncResult);
    if (lastRuns[userId].length > 3) {
      lastRuns[userId] = lastRuns[userId].slice(0, 3);
    }
    
    throw error;
  }
}

export function scheduleFreePbxCdrSync() {
  if (schedulerHandle) {
    return;
  }

  const intervalMinutes = config.freepbx.syncIntervalMinutes || 10;
  const intervalMs = intervalMinutes * 60 * 1000;

  schedulerHandle = setInterval(() => {
    runFreePbxCdrSync({ reason: 'scheduled' }).catch((error) => {
      logger.error({ error: error.message }, 'Scheduled FreePBX CDR sync failed');
    });
  }, intervalMs);

  logger.info({ intervalMinutes }, 'Scheduled FreePBX CDR sync job');

  // Trigger an immediate run so we don't wait for the first interval
  runFreePbxCdrSync({ reason: 'scheduled' }).catch((error) => {
    logger.error({ error: error.message }, 'Initial FreePBX CDR sync failed');
  });
}

