import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { BadRequestError, ForbiddenError } from '../utils/errors.js';
import { CALL_SOURCE } from '../utils/constants.js';
import { OpenAIService } from '../services/openai.service.js';

export class OpenAIUsageController {
  static async usageSummary(req, res, next) {
    try {
      // Super-admin only (platform usage visibility)
      if (req.user?.role !== 'super_admin') {
        throw new ForbiddenError('Only super admins can access OpenAI usage metrics');
      }

      const { startDate, endDate, userId, scope } = req.query;

      const parseDate = (value, fieldName) => {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestError(`Invalid ${fieldName} parameter`);
        }
        return parsed;
      };

      const range = {
        start: startDate ? parseDate(startDate, 'startDate') : null,
        end: endDate ? parseDate(endDate, 'endDate') : null,
      };

      if (range.start && range.end && range.start > range.end) {
        throw new BadRequestError('startDate must be before endDate');
      }

      const scopeNormalized = String(scope || '').toLowerCase().trim();
      const isAllUsers = scopeNormalized === 'all';

      // When not aggregating all users, allow selecting a specific userId; otherwise default to self.
      const targetUserId = isAllUsers ? null : (userId ? String(userId) : req.user.id);

      const where = [`c.source = $1`];
      const params = [CALL_SOURCE.FREEPBX_CDR];
      let paramIndex = 2;

      // Date filters (match UI date picker)
      if (range.start) {
        where.push(`COALESCE(c.external_created_at, c.created_at) >= $${paramIndex}`);
        params.push(range.start);
        paramIndex++;
      }

      if (range.end) {
        where.push(`COALESCE(c.external_created_at, c.created_at) <= $${paramIndex}`);
        params.push(range.end);
        paramIndex++;
      }

      if (targetUserId) {
        where.push(`c.user_id = $${paramIndex}`);
        params.push(targetUserId);
        paramIndex++;
      }

      // Calls processed: only include calls that were actually processed (transcribed/analyzed).
      const processedWhere = [...where, `c.processed_at IS NOT NULL`];

      // Audio seconds: use stored actual WAV duration from call processing (processed calls only).
      const audioSecondsExpr = `COALESCE(SUM(COALESCE(c.duration, 0))::bigint, 0)::bigint`;

      const sql = `
        SELECT
          COUNT(*)::bigint AS call_count,
          ${audioSecondsExpr} AS audio_seconds,
          COALESCE(SUM(COALESCE(c.gpt_input_tokens, 0))::bigint, 0)::bigint AS gpt_input_tokens,
          COALESCE(SUM(COALESCE(c.gpt_output_tokens, 0))::bigint, 0)::bigint AS gpt_output_tokens,
          COALESCE(SUM(COALESCE(c.gpt_total_tokens, 0))::bigint, 0)::bigint AS gpt_total_tokens
        FROM calls c
        WHERE ${processedWhere.join(' AND ')}
      `;

      logger.info(
        {
          adminId: req.user.id,
          isAllUsers,
          targetUserId,
          startDate: range.start ? range.start.toISOString() : null,
          endDate: range.end ? range.end.toISOString() : null,
        },
        'Fetching OpenAI usage summary'
      );

      const result = await query(sql, params);
      const row = result.rows[0] || {};

      const callCount = Number(row.call_count || 0);
      const audioSeconds = Number(row.audio_seconds || 0);
      const audioMinutes = audioSeconds / 60;
      const gptInputTokens = Number(row.gpt_input_tokens || 0);
      const gptOutputTokens = Number(row.gpt_output_tokens || 0);
      const gptTotalTokens = Number(row.gpt_total_tokens || 0);

      // Whisper model requests: sum of Whisper transcription attempts (can be > calls processed due to retries/reprocessing).
      const whisperWhere = [`c.source = $1`, `c.whisper_requested_at IS NOT NULL`];
      const whisperParams = [CALL_SOURCE.FREEPBX_CDR];
      let whisperParamIndex = 2;

      // Date filters for Whisper requests are based on the request timestamp (matches OpenAI dashboard).
      if (range.start) {
        whisperWhere.push(`c.whisper_requested_at >= $${whisperParamIndex}`);
        whisperParams.push(range.start);
        whisperParamIndex++;
      }
      if (range.end) {
        whisperWhere.push(`c.whisper_requested_at <= $${whisperParamIndex}`);
        whisperParams.push(range.end);
        whisperParamIndex++;
      }
      if (targetUserId) {
        whisperWhere.push(`c.user_id = $${whisperParamIndex}`);
        whisperParams.push(targetUserId);
        whisperParamIndex++;
      }

      const whisperSql = `
        SELECT
          COALESCE(SUM(COALESCE(c.whisper_requests, 0))::bigint, 0)::bigint AS whisper_model_requests
        FROM calls c
        WHERE ${whisperWhere.join(' AND ')}
      `;
      const whisperResult = await query(whisperSql, whisperParams);
      const whisperRow = whisperResult.rows[0] || {};
      const whisperModelRequests = Number(whisperRow.whisper_model_requests || 0);

      // Whisper estimated spend (platform-wide price).
      // Price is stored on the platform admin user’s openai_settings JSONB.
      let whisperPricePerMinute = null;
      let whisperEstimatedSpend = 0;
      let whisperOurPricePerMinute = null;
      let whisperOurEstimatedCharge = 0;
      try {
        const platform = await OpenAIService.getPlatformSettings();
        const rawPrice =
          platform?.whisper_price_per_minute ?? platform?.whisperPricePerMinute ?? null;
        const n =
          typeof rawPrice === 'number' ? rawPrice : Number.parseFloat(String(rawPrice ?? ''));
        if (Number.isFinite(n) && n >= 0) {
          whisperPricePerMinute = n;
          whisperEstimatedSpend = (audioSeconds / 60) * n;
        }

        const rawOurPrice =
          platform?.whisper_our_price_per_minute ?? platform?.whisperOurPricePerMinute ?? null;
        const our =
          typeof rawOurPrice === 'number'
            ? rawOurPrice
            : Number.parseFloat(String(rawOurPrice ?? ''));
        if (Number.isFinite(our) && our >= 0) {
          whisperOurPricePerMinute = our;
          whisperOurEstimatedCharge = (audioSeconds / 60) * our;
        }
      } catch {
        // non-fatal: usage still returns without spend
      }

      return res.json({
        callCount,
        audioSeconds,
        audioMinutes,
        whisperModelRequests,
        gptInputTokens,
        gptOutputTokens,
        gptTotalTokens,
        whisperPricePerMinute,
        whisperEstimatedSpend,
        whisperOurPricePerMinute,
        whisperOurEstimatedCharge,
        scope: isAllUsers ? 'all' : 'user',
        userId: targetUserId,
        startDate: range.start ? range.start.toISOString() : null,
        endDate: range.end ? range.end.toISOString() : null,
      });
    } catch (error) {
      next(error);
    }
  }

  static async usageHistory(req, res, next) {
    try {
      // Super-admin only (platform usage visibility)
      if (req.user?.role !== 'super_admin') {
        throw new ForbiddenError('Only super admins can access OpenAI usage metrics');
      }

      const { startDate, endDate, userId, scope } = req.query;

      const parseDate = (value, fieldName) => {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestError(`Invalid ${fieldName} parameter`);
        }
        return parsed;
      };

      const range = {
        start: startDate ? parseDate(startDate, 'startDate') : null,
        end: endDate ? parseDate(endDate, 'endDate') : null,
      };

      if (range.start && range.end && range.start > range.end) {
        throw new BadRequestError('startDate must be before endDate');
      }

      const scopeNormalized = String(scope || '').toLowerCase().trim();
      const isAllUsers = scopeNormalized === 'all';

      // When not aggregating all users, allow selecting a specific userId; otherwise default to self.
      const targetUserId = isAllUsers ? null : (userId ? String(userId) : req.user.id);

      // Platform whisper price (used for spend computation)
      let whisperPricePerMinute = null;
      let whisperOurPricePerMinute = null;
      try {
        const platform = await OpenAIService.getPlatformSettings();
        const rawPrice =
          platform?.whisper_price_per_minute ?? platform?.whisperPricePerMinute ?? null;
        const n =
          typeof rawPrice === 'number' ? rawPrice : Number.parseFloat(String(rawPrice ?? ''));
        if (Number.isFinite(n) && n >= 0) {
          whisperPricePerMinute = n;
        }

        const rawOurPrice =
          platform?.whisper_our_price_per_minute ?? platform?.whisperOurPricePerMinute ?? null;
        const our =
          typeof rawOurPrice === 'number'
            ? rawOurPrice
            : Number.parseFloat(String(rawOurPrice ?? ''));
        if (Number.isFinite(our) && our >= 0) {
          whisperOurPricePerMinute = our;
        }
      } catch {
        // non-fatal
      }

      // Processed calls (call-time buckets to match Usage summary cards)
      const processedWhere = [`c.source = $1`, `c.processed_at IS NOT NULL`];
      const processedParams = [CALL_SOURCE.FREEPBX_CDR];
      let processedParamIndex = 2;

      if (range.start) {
        processedWhere.push(`COALESCE(c.external_created_at, c.created_at) >= $${processedParamIndex}`);
        processedParams.push(range.start);
        processedParamIndex++;
      }
      if (range.end) {
        processedWhere.push(`COALESCE(c.external_created_at, c.created_at) <= $${processedParamIndex}`);
        processedParams.push(range.end);
        processedParamIndex++;
      }
      if (targetUserId) {
        processedWhere.push(`c.user_id = $${processedParamIndex}`);
        processedParams.push(targetUserId);
        processedParamIndex++;
      }

      const processedSql = `
        SELECT
          date_trunc('day', COALESCE(c.external_created_at, c.created_at)) AS day,
          COUNT(*)::bigint AS calls_processed,
          COALESCE(SUM(COALESCE(c.duration, 0))::bigint, 0)::bigint AS audio_seconds
        FROM calls c
        WHERE ${processedWhere.join(' AND ')}
        GROUP BY 1
        ORDER BY 1 ASC
      `;

      // Whisper requests (request-time buckets to match OpenAI dashboard + usage card)
      const whisperWhere = [`c.source = $1`, `c.whisper_requested_at IS NOT NULL`];
      const whisperParams = [CALL_SOURCE.FREEPBX_CDR];
      let whisperParamIndex = 2;

      if (range.start) {
        whisperWhere.push(`c.whisper_requested_at >= $${whisperParamIndex}`);
        whisperParams.push(range.start);
        whisperParamIndex++;
      }
      if (range.end) {
        whisperWhere.push(`c.whisper_requested_at <= $${whisperParamIndex}`);
        whisperParams.push(range.end);
        whisperParamIndex++;
      }
      if (targetUserId) {
        whisperWhere.push(`c.user_id = $${whisperParamIndex}`);
        whisperParams.push(targetUserId);
        whisperParamIndex++;
      }

      const whisperSql = `
        SELECT
          date_trunc('day', c.whisper_requested_at) AS day,
          COALESCE(SUM(COALESCE(c.whisper_requests, 0))::bigint, 0)::bigint AS whisper_model_requests
        FROM calls c
        WHERE ${whisperWhere.join(' AND ')}
        GROUP BY 1
        ORDER BY 1 ASC
      `;

      logger.info(
        {
          adminId: req.user.id,
          isAllUsers,
          targetUserId,
          startDate: range.start ? range.start.toISOString() : null,
          endDate: range.end ? range.end.toISOString() : null,
        },
        'Fetching OpenAI usage history'
      );

      const [processedResult, whisperResult] = await Promise.all([
        query(processedSql, processedParams),
        query(whisperSql, whisperParams),
      ]);

      const byDay = new Map();

      const toDayKey = (d) => {
        if (!d) return null;
        const dt = d instanceof Date ? d : new Date(d);
        if (Number.isNaN(dt.getTime())) return null;
        return dt.toISOString().slice(0, 10);
      };

      for (const r of processedResult.rows || []) {
        const day = toDayKey(r.day);
        if (!day) continue;
        const callsProcessed = Number(r.calls_processed || 0);
        const audioSeconds = Number(r.audio_seconds || 0);
        const audioMinutes = audioSeconds / 60;
        const whisperEstimatedSpend =
          whisperPricePerMinute !== null ? (audioSeconds / 60) * whisperPricePerMinute : 0;
        const whisperOurEstimatedCharge =
          whisperOurPricePerMinute !== null ? (audioSeconds / 60) * whisperOurPricePerMinute : 0;

        byDay.set(day, {
          day,
          callsProcessed,
          whisperModelRequests: 0,
          audioSeconds,
          audioMinutes,
          whisperEstimatedSpend,
          whisperOurEstimatedCharge,
        });
      }

      for (const r of whisperResult.rows || []) {
        const day = toDayKey(r.day);
        if (!day) continue;
        const whisperModelRequests = Number(r.whisper_model_requests || 0);
        const existing = byDay.get(day);
        if (existing) {
          existing.whisperModelRequests = whisperModelRequests;
        } else {
          byDay.set(day, {
            day,
            callsProcessed: 0,
            whisperModelRequests,
            audioSeconds: 0,
            audioMinutes: 0,
            whisperEstimatedSpend: 0,
            whisperOurEstimatedCharge: 0,
          });
        }
      }

      // Fill missing days when a date range is provided (better chart continuity)
      const points = [];
      if (range.start && range.end) {
        const cursor = new Date(range.start);
        cursor.setHours(0, 0, 0, 0);
        const endDay = new Date(range.end);
        endDay.setHours(0, 0, 0, 0);

        // Guard against huge ranges; if it's very large, return sparse points only.
        const maxDays = 3660; // ~10 years
        let i = 0;
        while (cursor <= endDay && i < maxDays) {
          const day = cursor.toISOString().slice(0, 10);
          points.push(
            byDay.get(day) || {
              day,
              callsProcessed: 0,
              whisperModelRequests: 0,
              audioSeconds: 0,
              audioMinutes: 0,
              whisperEstimatedSpend: 0,
              whisperOurEstimatedCharge: 0,
            }
          );
          cursor.setDate(cursor.getDate() + 1);
          i++;
        }
      } else {
        const sortedDays = Array.from(byDay.keys()).sort();
        for (const day of sortedDays) {
          points.push(byDay.get(day));
        }
      }

      return res.json({
        points,
      });
    } catch (error) {
      next(error);
    }
  }
}

