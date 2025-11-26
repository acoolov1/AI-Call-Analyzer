import { FreePbxCdrService } from '../services/freepbx-cdr.service.js';
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

export function getFreePbxCdrSyncStatus() {
  return {
    enabled: FreePbxCdrService.isEnabled(),
    lastRun,
  };
}

export async function runFreePbxCdrSync({ reason = 'manual', userId } = {}) {
  const targetUserId = userId || getTargetUserId();
  const freepbxSettings = await User.getFreePbxSettingsRaw(targetUserId);
  const openaiSettings = await User.getOpenAISettingsRaw(targetUserId);
  
  // Get user's timezone preference
  const user = await User.findById(targetUserId);
  const userTimezone = user?.timezone || 'America/New_York';

  if (!FreePbxCdrService.isEnabled(freepbxSettings)) {
    return { synced: 0, skipped: true, reason: 'disabled' };
  }

  if (inFlight) {
    return { synced: 0, skipped: true, reason: 'in-progress' };
  }

  inFlight = true;
  try {
    // Get the latest CDR-sourced call to determine where to sync from
    const latest = await Call.findLatestBySource(targetUserId, CALL_SOURCE.FREEPBX_CDR);
    const since = latest?.externalCreatedAt || latest?.createdAt;

    const cdrRecords = await FreePbxCdrService.listCdrRecords({ 
      since, 
      limit: 1000,
      freepbxSettings,
      userTimezone 
    });
    
    console.log(`📋 Found ${cdrRecords.length} CDR records to process`);
    console.log(`📅 Syncing calls since: ${since || 'beginning of time'}`);
    
    let synced = 0;

    for (const cdrRecord of cdrRecords) {
      // Check if this CDR record already exists
      const existing = await Call.findBySourceAndExternalId(
        CALL_SOURCE.FREEPBX_CDR, 
        cdrRecord.uniqueid
      );
      
      if (existing) {
        console.log(`⏭️  Skipping existing call: ${cdrRecord.uniqueid}`);
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
      
      const call = await Call.create({
        userId: targetUserId,
        callSid: `freepbx-cdr-${cdrRecord.uniqueid}`,
        recordingSid: cdrRecord.uniqueid,
        callerNumber: cdrRecord.callerNumber,
        callerName: cdrRecord.callerName,
        recordingUrl: null,
        recordingPath: cdrRecord.recordingfile || null,
        status: cdrRecord.recordingfile ? CALL_STATUS.PENDING : CALL_STATUS.COMPLETED,
        source: CALL_SOURCE.FREEPBX_CDR,
        externalId: cdrRecord.uniqueid,
        externalCreatedAt: isoCallDate,
        sourceMetadata: cdrRecord.rawCdr,
        syncedAt: new Date().toISOString(),
        createdAt: isoCallDate,
      });

      // Only process recording if one exists
      if (cdrRecord.recordingfile) {
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
        // No recording available - mark as completed without processing
        await Call.update(call.id, null, {
          status: CALL_STATUS.COMPLETED,
          analysis: 'No recording available for this call',
        });
        synced += 1;
      }
    }

    lastRun = {
      at: new Date().toISOString(),
      synced,
      reason,
    };

    return { synced, reason };
  } catch (error) {
    logger.error({ error: error.message }, 'FreePBX CDR sync failed');
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

export function scheduleFreePbxCdrSync() {
  if (!FreePbxCdrService.isEnabled()) {
    return;
  }

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
}

