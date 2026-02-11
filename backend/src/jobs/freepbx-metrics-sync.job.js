import { FreepbxServer } from '../models/FreepbxServer.js';
import { FreepbxUserManagerService } from '../services/freepbx-user-manager.service.js';
import { logger } from '../utils/logger.js';

let schedulerHandle = null;
let lastRun = null;
let inFlight = false;

export function getFreePbxMetricsSyncStatus() {
  return {
    enabled: schedulerHandle !== null,
    lastRun,
    inFlight,
  };
}

export async function runFreePbxMetricsSync({ reason = 'scheduled' } = {}) {
  if (inFlight) {
    logger.info('FreePBX metrics sync already in progress, skipping');
    return { synced: 0, skipped: true, reason: 'in-progress' };
  }

  inFlight = true;
  const startTime = Date.now();
  let successCount = 0;
  let errorCount = 0;

  try {
    logger.info({ reason }, 'Starting FreePBX metrics sync');
    
    // Fetch all FreePBX servers with decrypted passwords
    const servers = await FreepbxServer.findAllWithSecrets();
    
    if (!servers || servers.length === 0) {
      logger.info('No FreePBX servers configured, skipping metrics sync');
      lastRun = {
        at: new Date().toISOString(),
        synced: 0,
        errors: 0,
        reason,
        duration: Date.now() - startTime,
      };
      return { synced: 0, errors: 0, reason };
    }

    logger.info({ serverCount: servers.length }, 'Syncing metrics for FreePBX servers');

    // Process each server
    for (const server of servers) {
      try {
        logger.debug({ serverId: server.id, label: server.label }, 'Syncing server metrics');

        // Fetch all data in parallel
        const [usersResult, extensionsResult, metricsResult] = await Promise.all([
          FreepbxUserManagerService.listUsers(server),
          FreepbxUserManagerService.listExtensions(server),
          FreepbxUserManagerService.getSystemMetrics(server),
        ]);

        // Update database with fresh data
        await Promise.all([
          FreepbxServer.updateEndpoints(server.id, {
            extensions: extensionsResult.extensions,
            trunks: extensionsResult.trunks,
          }),
          FreepbxServer.updateMetrics(server.id, metricsResult),
        ]);

        successCount++;
        logger.debug({ serverId: server.id, label: server.label }, 'Successfully synced server metrics');
      } catch (error) {
        errorCount++;
        logger.error(
          { 
            serverId: server.id, 
            label: server.label, 
            error: error.message,
            stack: error.stack 
          }, 
          'Failed to sync metrics for FreePBX server'
        );
        // Continue with next server instead of failing entire job
      }
    }

    const duration = Date.now() - startTime;
    lastRun = {
      at: new Date().toISOString(),
      synced: successCount,
      errors: errorCount,
      total: servers.length,
      reason,
      duration,
    };

    logger.info(
      { 
        synced: successCount, 
        errors: errorCount, 
        total: servers.length,
        duration,
        reason 
      }, 
      'FreePBX metrics sync completed'
    );

    return { synced: successCount, errors: errorCount, total: servers.length, reason, duration };
  } catch (error) {
    errorCount++;
    logger.error({ error: error.message, stack: error.stack }, 'FreePBX metrics sync failed');
    lastRun = {
      at: new Date().toISOString(),
      error: error.message,
      reason,
      duration: Date.now() - startTime,
    };
    throw error;
  } finally {
    inFlight = false;
  }
}

export function scheduleFreePbxMetricsSync() {
  if (schedulerHandle) {
    logger.warn('FreePBX metrics sync job already scheduled');
    return;
  }

  const intervalMinutes = 10; // Auto-refresh every 10 minutes
  const intervalMs = intervalMinutes * 60 * 1000;

  // Run immediately on startup
  runFreePbxMetricsSync({ reason: 'startup' }).catch((error) => {
    logger.error({ error: error.message }, 'Initial FreePBX metrics sync failed');
  });

  // Then schedule recurring job
  schedulerHandle = setInterval(() => {
    runFreePbxMetricsSync({ reason: 'scheduled' }).catch((error) => {
      logger.error({ error: error.message }, 'Scheduled FreePBX metrics sync failed');
    });
  }, intervalMs);

  logger.info({ intervalMinutes }, 'Scheduled FreePBX metrics sync job');
}

export function stopFreePbxMetricsSync() {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
    logger.info('Stopped FreePBX metrics sync job');
  }
}

