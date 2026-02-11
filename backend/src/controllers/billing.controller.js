import { query } from '../config/database.js';
import { BadRequestError, ForbiddenError } from '../utils/errors.js';
import { CALL_SOURCE } from '../utils/constants.js';
import { OpenAIService } from '../services/openai.service.js';

const toUtcMonthStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const addUtcMonths = (d, months) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
const dayKeyUTC = (date) => {
  const dt = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
};
const monthKeyUTC = (date) => {
  const start = toUtcMonthStart(date instanceof Date ? date : new Date(date));
  if (Number.isNaN(start.getTime())) return null;
  return start.toISOString().slice(0, 10); // YYYY-MM-01
};

const parseDate = (value, fieldName) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError(`Invalid ${fieldName} parameter`);
  }
  return parsed;
};

const parseNonNegativeNumberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

async function getWhisperOurPricePerMinute() {
  try {
    const platform = await OpenAIService.getPlatformSettings();
    const raw =
      platform?.whisper_our_price_per_minute ?? platform?.whisperOurPricePerMinute ?? null;
    const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''));
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  } catch {
    return null;
  }
}

async function getUserBillingPlanSnapshot(userId) {
  const { User } = await import('../models/User.js');
  const raw = await User.getBillingSettingsRaw(userId);
  const basePlanMonthlyChargeUsd = parseNonNegativeNumberOrNull(
    raw?.base_plan_monthly_charge_usd ?? raw?.basePlanMonthlyChargeUsd ?? null
  );
  const basePlanIncludedAudioHours = parseNonNegativeNumberOrNull(
    raw?.base_plan_included_audio_hours ?? raw?.basePlanIncludedAudioHours ?? null
  );
  return {
    basePlanMonthlyChargeUsd,
    basePlanIncludedAudioHours,
  };
}

async function computeMonthlyAudioSeconds({ userId, monthStart, nextMonthStart }) {
  const sql = `
    SELECT
      COALESCE(SUM(COALESCE(c.duration, 0))::bigint, 0)::bigint AS audio_seconds
    FROM calls c
    WHERE
      c.source = $1
      AND c.processed_at IS NOT NULL
      AND c.user_id = $2
      AND COALESCE(c.external_created_at, c.created_at) >= $3
      AND COALESCE(c.external_created_at, c.created_at) < $4
  `;
  const result = await query(sql, [CALL_SOURCE.FREEPBX_CDR, userId, monthStart, nextMonthStart]);
  return Number(result.rows?.[0]?.audio_seconds ?? 0);
}

async function ensureBillingMonthRow({ userId, monthStartDate }) {
  const month = monthKeyUTC(monthStartDate);
  if (!month) {
    throw new BadRequestError('Invalid month');
  }

  const now = new Date();
  const currentMonthStart = toUtcMonthStart(now);
  const isCurrentMonth = toUtcMonthStart(monthStartDate).getTime() === currentMonthStart.getTime();
  const shouldFinalize = !isCurrentMonth && toUtcMonthStart(monthStartDate).getTime() < currentMonthStart.getTime();

  const existingResult = await query(
    `SELECT *
     FROM billing_months
     WHERE user_id = $1 AND month = $2
     LIMIT 1`,
    [userId, month]
  );
  const existing = existingResult.rows?.[0] || null;
  if (existing && existing.is_finalized === true) {
    return existing;
  }

  const nextMonthStart = addUtcMonths(monthStartDate, 1);
  const whisperOurPricePerMinute = await getWhisperOurPricePerMinute();

  const currentPlan = await getUserBillingPlanSnapshot(userId);

  const chooseSnapshot = () => {
    // For past months, preserve existing snapshot if present (prevents retroactive plan changes).
    if (!isCurrentMonth && existing) {
      const monthly = parseNonNegativeNumberOrNull(existing.base_plan_monthly_charge_usd);
      const included = parseNonNegativeNumberOrNull(existing.base_plan_included_audio_hours);
      return {
        basePlanMonthlyChargeUsd: monthly !== null ? monthly : currentPlan.basePlanMonthlyChargeUsd,
        basePlanIncludedAudioHours: included !== null ? included : currentPlan.basePlanIncludedAudioHours,
      };
    }
    return currentPlan;
  };

  const snapshot = chooseSnapshot();
  const basePlanMonthlyChargeUsd = Number(snapshot.basePlanMonthlyChargeUsd ?? 0) || 0;
  const basePlanIncludedAudioHours = Number(snapshot.basePlanIncludedAudioHours ?? 0) || 0;
  const includedSeconds = Math.max(0, basePlanIncludedAudioHours * 3600);

  const audioSeconds = Math.max(
    0,
    await computeMonthlyAudioSeconds({ userId, monthStart: monthStartDate, nextMonthStart })
  );
  const overageSeconds = Math.max(0, audioSeconds - includedSeconds);

  const audioMinutes = audioSeconds / 60;
  const overageMinutes = overageSeconds / 60;
  const overageChargeUsd =
    whisperOurPricePerMinute !== null ? (overageSeconds / 60) * whisperOurPricePerMinute : 0;
  const totalChargeUsd = basePlanMonthlyChargeUsd + overageChargeUsd;

  const upsertSql = `
    INSERT INTO billing_months (
      user_id,
      month,
      base_plan_monthly_charge_usd,
      base_plan_included_audio_hours,
      audio_seconds,
      audio_minutes,
      overage_seconds,
      overage_minutes,
      overage_charge_usd,
      total_charge_usd,
      is_finalized,
      calculated_at,
      updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW()
    )
    ON CONFLICT (user_id, month) DO UPDATE SET
      base_plan_monthly_charge_usd = EXCLUDED.base_plan_monthly_charge_usd,
      base_plan_included_audio_hours = EXCLUDED.base_plan_included_audio_hours,
      audio_seconds = EXCLUDED.audio_seconds,
      audio_minutes = EXCLUDED.audio_minutes,
      overage_seconds = EXCLUDED.overage_seconds,
      overage_minutes = EXCLUDED.overage_minutes,
      overage_charge_usd = EXCLUDED.overage_charge_usd,
      total_charge_usd = EXCLUDED.total_charge_usd,
      is_finalized = EXCLUDED.is_finalized,
      calculated_at = EXCLUDED.calculated_at,
      updated_at = NOW()
    RETURNING *
  `;
  const upsertResult = await query(upsertSql, [
    userId,
    month,
    basePlanMonthlyChargeUsd,
    basePlanIncludedAudioHours,
    Math.round(audioSeconds),
    audioMinutes,
    Math.round(overageSeconds),
    overageMinutes,
    overageChargeUsd,
    totalChargeUsd,
    shouldFinalize,
  ]);
  return upsertResult.rows?.[0] || null;
}

export class BillingController {
  static async audioDaily(req, res, next) {
    try {
      const { startDate, endDate, userId } = req.query;

      const range = {
        start: startDate ? parseDate(startDate, 'startDate') : null,
        end: endDate ? parseDate(endDate, 'endDate') : null,
      };

      if (!range.start || !range.end) {
        throw new BadRequestError('startDate and endDate are required');
      }
      if (range.start > range.end) {
        throw new BadRequestError('startDate must be before endDate');
      }

      const targetUserId = userId ? String(userId) : req.user.id;
      if (userId && req.user?.role !== 'super_admin') {
        throw new ForbiddenError('Only super admins can query another user');
      }

      const startDay = new Date(range.start);
      startDay.setUTCHours(0, 0, 0, 0);
      const endDay = new Date(range.end);
      endDay.setUTCHours(0, 0, 0, 0);

      const points = [];

      // Loop month-by-month (UTC)
      let cursorMonth = toUtcMonthStart(startDay);
      const endMonth = toUtcMonthStart(endDay);
      const maxMonths = 240; // guard
      let i = 0;

      while (cursorMonth <= endMonth && i < maxMonths) {
        const monthStart = cursorMonth;
        const nextMonthStart = addUtcMonths(monthStart, 1);

        // Ensure we have a month row (and get the included threshold)
        const monthRow = await ensureBillingMonthRow({ userId: targetUserId, monthStartDate: monthStart });
        const includedHours = parseNonNegativeNumberOrNull(monthRow?.base_plan_included_audio_hours) ?? 0;
        const includedSeconds = Math.max(0, includedHours * 3600);

        // Query daily totals for this month up to range.end (for correct cumulative overage allocation)
        const dailySql = `
          SELECT
            to_char(date_trunc('day', COALESCE(c.external_created_at, c.created_at) AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
            COALESCE(SUM(COALESCE(c.duration, 0))::bigint, 0)::bigint AS audio_seconds
          FROM calls c
          WHERE
            c.source = $1
            AND c.processed_at IS NOT NULL
            AND c.user_id = $2
            AND COALESCE(c.external_created_at, c.created_at) >= $3
            AND COALESCE(c.external_created_at, c.created_at) < $4
            AND COALESCE(c.external_created_at, c.created_at) <= $5
          GROUP BY 1
          ORDER BY 1 ASC
        `;
        const dailyResult = await query(dailySql, [
          CALL_SOURCE.FREEPBX_CDR,
          targetUserId,
          monthStart,
          nextMonthStart,
          range.end,
        ]);

        const byDay = new Map();
        for (const r of dailyResult.rows || []) {
          const day = String(r.day || '').trim();
          if (!day) continue;
          byDay.set(day, Number(r.audio_seconds || 0));
        }

        // Fill days from month start through the last day we care about for this month.
        const lastRelevantDay = (() => {
          const last = new Date(Math.min(endDay.getTime(), new Date(nextMonthStart.getTime() - 1).getTime()));
          last.setUTCHours(0, 0, 0, 0);
          return last;
        })();

        let cumAudioSeconds = 0;
        const dayCursor = new Date(monthStart);
        dayCursor.setUTCHours(0, 0, 0, 0);
        const maxDays = 3660;
        let di = 0;

        while (dayCursor <= lastRelevantDay && di < maxDays) {
          const dayKey = dayKeyUTC(dayCursor);
          const dayAudioSeconds = Math.max(0, Number(byDay.get(dayKey) || 0));
          const prevCum = cumAudioSeconds;
          cumAudioSeconds += dayAudioSeconds;

          const prevOverage = Math.max(0, prevCum - includedSeconds);
          const newOverage = Math.max(0, cumAudioSeconds - includedSeconds);
          const dayOverageSeconds = Math.max(0, newOverage - prevOverage);

          // Emit only days inside the requested range
          if (dayCursor >= startDay && dayCursor <= endDay) {
            points.push({
              day: dayKey,
              audioSeconds: dayAudioSeconds,
              audioMinutes: dayAudioSeconds / 60,
              overageSeconds: dayOverageSeconds,
              overageMinutes: dayOverageSeconds / 60,
            });
          }

          dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
          di++;
        }

        cursorMonth = nextMonthStart;
        i++;
      }

      return res.json({ points });
    } catch (error) {
      next(error);
    }
  }

  static async monthlyHistory(req, res, next) {
    try {
      const { months, userId } = req.query;

      const targetUserId = userId ? String(userId) : req.user.id;
      if (userId && req.user?.role !== 'super_admin') {
        throw new ForbiddenError('Only super admins can query another user');
      }

      const countRaw = months === undefined ? 12 : Number.parseInt(String(months), 10);
      const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.min(countRaw, 120) : 12;

      const now = new Date();
      const currentMonthStart = toUtcMonthStart(now);

      const whisperOurPricePerMinute = await getWhisperOurPricePerMinute();

      // Do not return months before the user existed.
      const createdResult = await query(`SELECT created_at FROM users WHERE id = $1`, [targetUserId]);
      const createdAtRaw = createdResult.rows?.[0]?.created_at ?? null;
      const createdAt = createdAtRaw ? new Date(createdAtRaw) : null;
      const createdMonthStart =
        createdAt && !Number.isNaN(createdAt.getTime()) ? toUtcMonthStart(createdAt) : null;

      const out = [];
      for (let i = 0; i < count; i++) {
        const monthStart = addUtcMonths(currentMonthStart, -i);
        if (createdMonthStart && monthStart < createdMonthStart) break;
        const row = await ensureBillingMonthRow({ userId: targetUserId, monthStartDate: monthStart });
        if (row) out.push(row);
      }

      const normalizeMonth = (value) => {
        if (!value) return null;
        if (value instanceof Date) return value.toISOString().slice(0, 10);
        const s = String(value).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return null;
      };

      // Return newest -> oldest (sort by normalized YYYY-MM-DD key)
      out.sort((a, b) => {
        const aKey = normalizeMonth(a?.month) || '';
        const bKey = normalizeMonth(b?.month) || '';
        return bKey.localeCompare(aKey);
      });

      return res.json({
        whisperOurPricePerMinute,
        months: out.map((r) => ({
          month: normalizeMonth(r.month),
          basePlanMonthlyChargeUsd: Number(r.base_plan_monthly_charge_usd ?? 0) || 0,
          basePlanIncludedAudioHours: Number(r.base_plan_included_audio_hours ?? 0) || 0,
          audioSeconds: Number(r.audio_seconds ?? 0) || 0,
          audioMinutes: Number(r.audio_minutes ?? 0) || 0,
          overageSeconds: Number(r.overage_seconds ?? 0) || 0,
          overageMinutes: Number(r.overage_minutes ?? 0) || 0,
          overageChargeUsd: Number(r.overage_charge_usd ?? 0) || 0,
          totalChargeUsd: Number(r.total_charge_usd ?? 0) || 0,
          isFinalized: Boolean(r.is_finalized),
          calculatedAt: r.calculated_at ? new Date(r.calculated_at).toISOString() : null,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
}

