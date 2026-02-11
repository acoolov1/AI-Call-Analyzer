import os from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

let schedulerHandle = null;
let schedulerTimeoutHandle = null;
let inFlight = false;

const SAMPLE_INTERVAL_MINUTES = 10;
const RETENTION_DAYS = 30;

async function getDiskPercent() {
  try {
    // Portable output: POSIX format with fixed columns
    // Filesystem 1024-blocks Used Available Capacity Mounted on
    const { stdout } = await execAsync('df -P /');
    const lines = String(stdout || '').trim().split('\n');
    if (lines.length < 2) return 0;
    const parts = lines[1].trim().split(/\s+/);
    // Capacity is typically column 5 like "20%"
    const cap = parts[4] || '0%';
    const n = Number.parseInt(String(cap).replace('%', ''), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function collectLightweightSample() {
  const loadAverage = os.loadavg();
  const cpuCount = Math.max(1, os.cpus().length || 1);
  const cpuUsage = Math.min(100, (loadAverage[0] / cpuCount) * 100);

  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  const memoryPercentUsed = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0;

  const diskPercent = await getDiskPercent();

  return {
    cpuPercent: Math.round(cpuUsage * 100) / 100,
    memoryPercent: Math.round(memoryPercentUsed * 100) / 100,
    diskPercent: Math.round(diskPercent * 100) / 100,
  };
}

export async function runSystemMetricsSample({ reason = 'scheduled' } = {}) {
  if (inFlight) return { skipped: true, reason: 'in-progress' };
  inFlight = true;
  const startedAt = Date.now();

  try {
    const sample = await collectLightweightSample();

    await query(
      `INSERT INTO system_metrics_samples (recorded_at, cpu_percent, memory_percent, disk_percent)
       VALUES (NOW(), $1, $2, $3)`,
      [sample.cpuPercent, sample.memoryPercent, sample.diskPercent]
    );

    // Prune old samples (simple retention policy)
    await query(
      `DELETE FROM system_metrics_samples
       WHERE recorded_at < NOW() - ($1::text || ' days')::interval`,
      [String(RETENTION_DAYS)]
    );

    logger.debug(
      { reason, durationMs: Date.now() - startedAt, ...sample },
      'System metrics sample recorded'
    );
    return { ok: true, reason };
  } catch (error) {
    logger.warn({ reason, error: error.message }, 'Failed to record system metrics sample');
    return { ok: false, reason, error: error.message };
  } finally {
    inFlight = false;
  }
}

export function scheduleSystemMetricsHistorySampling() {
  if (schedulerHandle || schedulerTimeoutHandle) return;

  const intervalMs = SAMPLE_INTERVAL_MINUTES * 60 * 1000;

  const msUntilNextBoundary = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ms = now.getMilliseconds();

    const nextMinute = minutes - (minutes % SAMPLE_INTERVAL_MINUTES) + SAMPLE_INTERVAL_MINUTES;
    const next = new Date(now);
    next.setSeconds(0, 0);

    if (nextMinute >= 60) {
      next.setHours(now.getHours() + 1, 0, 0, 0); // top of next hour
    } else {
      next.setMinutes(nextMinute, 0, 0);
    }

    const delta = next.getTime() - now.getTime();
    // Guard: never schedule negative/0; minimum 250ms.
    return Math.max(delta, 250 - (seconds * 1000 + ms));
  };

  const firstDelay = msUntilNextBoundary();

  schedulerTimeoutHandle = setTimeout(() => {
    schedulerTimeoutHandle = null;
    // First aligned run
    runSystemMetricsSample({ reason: 'aligned' }).catch(() => {});

    // Then every 10 minutes aligned to wall clock
    schedulerHandle = setInterval(() => {
      runSystemMetricsSample({ reason: 'scheduled' }).catch(() => {});
    }, intervalMs);
  }, firstDelay);

  logger.info(
    { intervalMinutes: SAMPLE_INTERVAL_MINUTES, firstDelayMs: firstDelay },
    'Scheduled system metrics history sampling (aligned)'
  );
}

export function stopSystemMetricsHistorySampling() {
  if (schedulerTimeoutHandle) {
    clearTimeout(schedulerTimeoutHandle);
    schedulerTimeoutHandle = null;
  }
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}

