import { DateTime } from 'luxon';

export function isValidDailyHHMM(value) {
  if (typeof value !== 'string') return false;
  const m = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return Boolean(m);
}

export function normalizeDailyHHMM(value, fallback = '02:00') {
  if (isValidDailyHHMM(value)) return value.trim();
  return fallback;
}

/**
 * Compute the next UTC Date when the job should run, based on a daily HH:MM in an IANA timezone.
 */
export function computeNextRunAtUtcISO({ timezone, hhmm, now = new Date() }) {
  const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC';
  const timeStr = normalizeDailyHHMM(hhmm, '02:00');
  const [hourStr, minuteStr] = timeStr.split(':');
  const hour = Number.parseInt(hourStr, 10);
  const minute = Number.parseInt(minuteStr, 10);

  const nowTz = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(tz);
  if (!nowTz.isValid) {
    // If timezone is invalid in this runtime, fall back to UTC.
    return computeNextRunAtUtcISO({ timezone: 'UTC', hhmm: timeStr, now });
  }

  let candidate = nowTz.set({ hour, minute, second: 0, millisecond: 0 });
  if (!candidate.isValid) {
    // Handle invalid local time (DST gap). Choose the next valid minute.
    candidate = candidate.plus({ hours: 1 }).set({ minute: 0, second: 0, millisecond: 0 });
  }

  if (candidate <= nowTz) {
    candidate = candidate.plus({ days: 1 });
  }

  return candidate.toUTC().toISO();
}

/**
 * Returns true if lastRunAtUtc (ISO) occurred on the same local calendar date as now, in the given timezone.
 */
export function hasRunToday({ lastRunAtUtcISO, timezone, now = new Date() }) {
  if (!lastRunAtUtcISO) return false;
  const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC';

  const last = DateTime.fromISO(String(lastRunAtUtcISO), { zone: 'utc' }).setZone(tz);
  if (!last.isValid) return false;
  const nowTz = DateTime.fromJSDate(now, { zone: 'utc' }).setZone(tz);
  if (!nowTz.isValid) return false;

  return last.toISODate() === nowTz.toISODate();
}

