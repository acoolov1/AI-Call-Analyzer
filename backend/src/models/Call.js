import { query } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import { CALL_SOURCE, CALL_STATUS } from '../utils/constants.js';

export class Call {
  static async create(data) {
    const {
      userId,
      callSid,
      recordingSid,
      callerNumber,
      callerName,
      recordingUrl,
      recordingPath = null,
      status = CALL_STATUS.PENDING,
      source = CALL_SOURCE.TWILIO,
      externalId = null,
      externalCreatedAt = null,
      sourceMetadata = null,
      direction = null,
      syncedAt = null,
      createdAt = null,
    } = data;

    const result = await query(
      `INSERT INTO calls (
        user_id, call_sid, recording_sid, caller_number, caller_name,
        transcript, analysis, recording_url, recording_path, status,
        duration, source, external_id, external_created_at, source_metadata, direction,
        synced_at, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        NULL, NULL, $6, $7, $8,
        NULL, $9, $10, $11, $12, $13,
        $14, COALESCE($15, NOW()), NOW()
      )
      RETURNING *`,
      [
        userId,
        callSid,
        recordingSid,
        callerNumber,
        callerName,
        recordingUrl,
        recordingPath,
        status,
        source,
        externalId,
        externalCreatedAt,
        sourceMetadata ?? null,
        direction,
        syncedAt,
        createdAt,
      ]
    );

    return this.mapRowToCall(result.rows[0]);
  }

  static async findById(id, userId = null) {
    let sql = 'SELECT * FROM calls WHERE id = $1';
    const params = [id];

    if (userId) {
      sql += ' AND user_id = $2';
      params.push(userId);
    }

    const result = await query(sql, params);

    if (result.rows.length === 0) {
      throw new NotFoundError('Call');
    }

    return this.mapRowToCall(result.rows[0]);
  }

  static async findByCallSid(callSid) {
    const result = await query(
      'SELECT * FROM calls WHERE call_sid = $1',
      [callSid]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToCall(result.rows[0]);
  }

  static async findByUserId(userId, options = {}) {
    const { limit = 50, offset = 0, status, source, startDate, endDate } = options;
    
    let sql = 'SELECT * FROM calls WHERE user_id = $1';
    const params = [userId];
    let paramIndex = 2;

    if (status) {
      sql += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (source) {
      sql += ` AND source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }

    if (startDate) {
      sql += ` AND COALESCE(external_created_at, created_at) >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND COALESCE(external_created_at, created_at) <= $${paramIndex}`;
      params.push(new Date(endDate));
      paramIndex++;
    }

    sql += ` ORDER BY COALESCE(external_created_at, created_at) DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(row => this.mapRowToCall(row));
  }

  /**
   * List FreePBX CDR calls for a user with server-side filters.
   * Filters are ANDed together.
   */
  static async findCdrCallsByUserIdWithFilters(userId, options = {}) {
    const {
      limit = 50,
      offset = 0,
      startDate,
      endDate,
      direction,
      includeInbound,
      includeOutbound,
      includeInternal,
      excludedInboundExtensions,
      excludedOutboundExtensions,
      excludedInternalExtensions,
      booking,
      sentiment,
      notAnswered,
      search,
    } = options;

    let sql = `
      SELECT c.*
      FROM calls c
      LEFT JOIN call_metadata cm ON cm.call_id = c.id
      WHERE c.user_id = $1 AND c.source = $2
    `;
    const params = [userId, CALL_SOURCE.FREEPBX_CDR];
    let paramIndex = 3;

    if (startDate) {
      sql += ` AND COALESCE(c.external_created_at, c.created_at) >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND COALESCE(c.external_created_at, c.created_at) <= $${paramIndex}`;
      params.push(new Date(endDate));
      paramIndex++;
    }

    if (direction) {
      sql += ` AND c.direction = $${paramIndex}`;
      params.push(direction);
      paramIndex++;
    }

    // Optional global direction enablement (used by call-history direction toggles)
    if (includeInbound === false) {
      sql += ` AND (c.direction IS NULL OR c.direction <> 'inbound')`;
    }
    if (includeOutbound === false) {
      sql += ` AND (c.direction IS NULL OR c.direction <> 'outbound')`;
    }
    if (includeInternal === false) {
      sql += ` AND (c.direction IS NULL OR c.direction <> 'internal')`;
    }

    const normalizeExtensionList = (value) => {
      if (!Array.isArray(value)) return [];
      return value
        .map((v) => String(v || '').trim())
        .filter((v) => v.length > 0);
    };

    const excludedInbound = normalizeExtensionList(excludedInboundExtensions);
    const excludedOutbound = normalizeExtensionList(excludedOutboundExtensions);
    const excludedInternal = normalizeExtensionList(excludedInternalExtensions);

    if (excludedInbound.length > 0) {
      sql += ` AND NOT (c.direction = 'inbound' AND TRIM(c.source_metadata->>'answered_extension') = ANY($${paramIndex}::text[]))`;
      params.push(excludedInbound);
      paramIndex++;
    }

    if (excludedOutbound.length > 0) {
      sql += ` AND NOT (c.direction = 'outbound' AND TRIM(c.source_metadata->>'answered_extension') = ANY($${paramIndex}::text[]))`;
      params.push(excludedOutbound);
      paramIndex++;
    }

    if (excludedInternal.length > 0) {
      sql += ` AND NOT (
        c.direction = 'internal' AND (
          TRIM(COALESCE(c.source_metadata->>'cnum', c.source_metadata->>'src', '')) = ANY($${paramIndex}::text[])
          OR TRIM(COALESCE(c.source_metadata->>'answered_extension', c.source_metadata->>'dst', '')) = ANY($${paramIndex}::text[])
        )
      )`;
      params.push(excludedInternal);
      paramIndex++;
    }

    if (notAnswered) {
      sql += ` AND NULLIF(UPPER(c.source_metadata->>'disposition'), '') IS NOT NULL`;
      sql += ` AND UPPER(c.source_metadata->>'disposition') <> 'ANSWERED'`;
    }

    if (booking) {
      if (booking === 'unknown') {
        sql += ` AND (cm.booking IS NULL OR cm.booking = '')`;
      } else {
        sql += ` AND cm.booking = $${paramIndex}`;
        params.push(booking);
        paramIndex++;
      }
    }

    if (sentiment) {
      if (sentiment === 'unknown') {
        sql += ` AND (cm.sentiment IS NULL OR cm.sentiment = '')`;
      } else {
        sql += ` AND LOWER(cm.sentiment) = $${paramIndex}`;
        params.push(String(sentiment).toLowerCase());
        paramIndex++;
      }
    }

    if (search) {
      const q = `%${String(search).trim()}%`;
      sql += ` AND (
        COALESCE(c.caller_name, '') ILIKE $${paramIndex}
        OR COALESCE(c.caller_number, '') ILIKE $${paramIndex}
        OR COALESCE(c.direction, '') ILIKE $${paramIndex}
        OR COALESCE(c.transcript, '') ILIKE $${paramIndex}
        OR COALESCE(c.analysis, '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'dst_cnam'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'dst'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'disposition'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'dstchannel'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'answered_extension'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'answered_name'), '') ILIKE $${paramIndex}
      )`;
      params.push(q);
      paramIndex++;
    }

    sql += ` ORDER BY COALESCE(c.external_created_at, c.created_at) DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(row => this.mapRowToCall(row));
  }

  static async countCdrCallsByUserIdWithFilters(userId, options = {}) {
    const {
      startDate,
      endDate,
      direction,
      includeInbound,
      includeOutbound,
      includeInternal,
      excludedInboundExtensions,
      excludedOutboundExtensions,
      excludedInternalExtensions,
      booking,
      sentiment,
      notAnswered,
      search,
    } = options;

    let sql = `
      SELECT COUNT(*) as count
      FROM calls c
      LEFT JOIN call_metadata cm ON cm.call_id = c.id
      WHERE c.user_id = $1 AND c.source = $2
    `;
    const params = [userId, CALL_SOURCE.FREEPBX_CDR];
    let paramIndex = 3;

    if (startDate) {
      sql += ` AND COALESCE(c.external_created_at, c.created_at) >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND COALESCE(c.external_created_at, c.created_at) <= $${paramIndex}`;
      params.push(new Date(endDate));
      paramIndex++;
    }

    if (direction) {
      sql += ` AND c.direction = $${paramIndex}`;
      params.push(direction);
      paramIndex++;
    }

    if (includeInbound === false) {
      sql += ` AND (c.direction IS NULL OR c.direction <> 'inbound')`;
    }
    if (includeOutbound === false) {
      sql += ` AND (c.direction IS NULL OR c.direction <> 'outbound')`;
    }
    if (includeInternal === false) {
      sql += ` AND (c.direction IS NULL OR c.direction <> 'internal')`;
    }

    const normalizeExtensionList = (value) => {
      if (!Array.isArray(value)) return [];
      return value
        .map((v) => String(v || '').trim())
        .filter((v) => v.length > 0);
    };

    const excludedInbound = normalizeExtensionList(excludedInboundExtensions);
    const excludedOutbound = normalizeExtensionList(excludedOutboundExtensions);
    const excludedInternal = normalizeExtensionList(excludedInternalExtensions);

    if (excludedInbound.length > 0) {
      sql += ` AND NOT (c.direction = 'inbound' AND TRIM(c.source_metadata->>'answered_extension') = ANY($${paramIndex}::text[]))`;
      params.push(excludedInbound);
      paramIndex++;
    }

    if (excludedOutbound.length > 0) {
      sql += ` AND NOT (c.direction = 'outbound' AND TRIM(c.source_metadata->>'answered_extension') = ANY($${paramIndex}::text[]))`;
      params.push(excludedOutbound);
      paramIndex++;
    }

    if (excludedInternal.length > 0) {
      sql += ` AND NOT (
        c.direction = 'internal' AND (
          TRIM(COALESCE(c.source_metadata->>'cnum', c.source_metadata->>'src', '')) = ANY($${paramIndex}::text[])
          OR TRIM(COALESCE(c.source_metadata->>'answered_extension', c.source_metadata->>'dst', '')) = ANY($${paramIndex}::text[])
        )
      )`;
      params.push(excludedInternal);
      paramIndex++;
    }

    if (notAnswered) {
      sql += ` AND NULLIF(UPPER(c.source_metadata->>'disposition'), '') IS NOT NULL`;
      sql += ` AND UPPER(c.source_metadata->>'disposition') <> 'ANSWERED'`;
    }

    if (booking) {
      if (booking === 'unknown') {
        sql += ` AND (cm.booking IS NULL OR cm.booking = '')`;
      } else {
        sql += ` AND cm.booking = $${paramIndex}`;
        params.push(booking);
        paramIndex++;
      }
    }

    if (sentiment) {
      if (sentiment === 'unknown') {
        sql += ` AND (cm.sentiment IS NULL OR cm.sentiment = '')`;
      } else {
        sql += ` AND LOWER(cm.sentiment) = $${paramIndex}`;
        params.push(String(sentiment).toLowerCase());
        paramIndex++;
      }
    }

    if (search) {
      const q = `%${String(search).trim()}%`;
      sql += ` AND (
        COALESCE(c.caller_name, '') ILIKE $${paramIndex}
        OR COALESCE(c.caller_number, '') ILIKE $${paramIndex}
        OR COALESCE(c.direction, '') ILIKE $${paramIndex}
        OR COALESCE(c.transcript, '') ILIKE $${paramIndex}
        OR COALESCE(c.analysis, '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'dst_cnam'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'dst'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'disposition'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'dstchannel'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'answered_extension'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'answered_name'), '') ILIKE $${paramIndex}
      )`;
      params.push(q);
      paramIndex++;
    }

    const result = await query(sql, params);
    return parseInt(result.rows[0]?.count || 0, 10);
  }

  static async findCdrCallIdsByUserIdWithFilters(userId, options = {}) {
    const {
      startDate,
      endDate,
      direction,
      includeInbound,
      includeOutbound,
      includeInternal,
      excludedInboundExtensions,
      excludedOutboundExtensions,
      excludedInternalExtensions,
      booking,
      sentiment,
      notAnswered,
      search,
    } = options;

    let sql = `
      SELECT c.id
      FROM calls c
      LEFT JOIN call_metadata cm ON cm.call_id = c.id
      WHERE c.user_id = $1 AND c.source = $2
    `;
    const params = [userId, CALL_SOURCE.FREEPBX_CDR];
    let paramIndex = 3;

    if (startDate) {
      sql += ` AND COALESCE(c.external_created_at, c.created_at) >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND COALESCE(c.external_created_at, c.created_at) <= $${paramIndex}`;
      params.push(new Date(endDate));
      paramIndex++;
    }

    if (direction) {
      sql += ` AND c.direction = $${paramIndex}`;
      params.push(direction);
      paramIndex++;
    }

    if (includeInbound === false) {
      sql += ` AND (c.direction IS NULL OR c.direction <> 'inbound')`;
    }
    if (includeOutbound === false) {
      sql += ` AND (c.direction IS NULL OR c.direction <> 'outbound')`;
    }
    if (includeInternal === false) {
      sql += ` AND (c.direction IS NULL OR c.direction <> 'internal')`;
    }

    const normalizeExtensionList = (value) => {
      if (!Array.isArray(value)) return [];
      return value
        .map((v) => String(v || '').trim())
        .filter((v) => v.length > 0);
    };

    const excludedInbound = normalizeExtensionList(excludedInboundExtensions);
    const excludedOutbound = normalizeExtensionList(excludedOutboundExtensions);
    const excludedInternal = normalizeExtensionList(excludedInternalExtensions);

    if (excludedInbound.length > 0) {
      sql += ` AND NOT (c.direction = 'inbound' AND TRIM(c.source_metadata->>'answered_extension') = ANY($${paramIndex}::text[]))`;
      params.push(excludedInbound);
      paramIndex++;
    }

    if (excludedOutbound.length > 0) {
      sql += ` AND NOT (c.direction = 'outbound' AND TRIM(c.source_metadata->>'answered_extension') = ANY($${paramIndex}::text[]))`;
      params.push(excludedOutbound);
      paramIndex++;
    }

    if (excludedInternal.length > 0) {
      sql += ` AND NOT (
        c.direction = 'internal' AND (
          TRIM(COALESCE(c.source_metadata->>'cnum', c.source_metadata->>'src', '')) = ANY($${paramIndex}::text[])
          OR TRIM(COALESCE(c.source_metadata->>'answered_extension', c.source_metadata->>'dst', '')) = ANY($${paramIndex}::text[])
        )
      )`;
      params.push(excludedInternal);
      paramIndex++;
    }

    if (notAnswered) {
      sql += ` AND NULLIF(UPPER(c.source_metadata->>'disposition'), '') IS NOT NULL`;
      sql += ` AND UPPER(c.source_metadata->>'disposition') <> 'ANSWERED'`;
    }

    if (booking) {
      if (booking === 'unknown') {
        sql += ` AND (cm.booking IS NULL OR cm.booking = '')`;
      } else {
        sql += ` AND cm.booking = $${paramIndex}`;
        params.push(booking);
        paramIndex++;
      }
    }

    if (sentiment) {
      if (sentiment === 'unknown') {
        sql += ` AND (cm.sentiment IS NULL OR cm.sentiment = '')`;
      } else {
        sql += ` AND LOWER(cm.sentiment) = $${paramIndex}`;
        params.push(String(sentiment).toLowerCase());
        paramIndex++;
      }
    }

    if (search) {
      const q = `%${String(search).trim()}%`;
      sql += ` AND (
        COALESCE(c.caller_name, '') ILIKE $${paramIndex}
        OR COALESCE(c.caller_number, '') ILIKE $${paramIndex}
        OR COALESCE(c.direction, '') ILIKE $${paramIndex}
        OR COALESCE(c.transcript, '') ILIKE $${paramIndex}
        OR COALESCE(c.analysis, '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'dst_cnam'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'dst'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'disposition'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'dstchannel'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'answered_extension'), '') ILIKE $${paramIndex}
        OR COALESCE(TRIM(c.source_metadata->>'answered_name'), '') ILIKE $${paramIndex}
      )`;
      params.push(q);
      paramIndex++;
    }

    sql += ` ORDER BY COALESCE(c.external_created_at, c.created_at) DESC`;

    const result = await query(sql, params);
    return result.rows.map((r) => r.id);
  }

  static async update(id, userId, updates) {
    const allowedFields = [
      'transcript',
      'analysis',
      'status',
      'duration',
      'processedAt',
      'recordingUrl',
      'recordingSid',
      'recordingPath',
      'recordingDeletedAt',
      'recordingDeletedReason',
      'source',
      'gptModel',
      'gptInputTokens',
      'gptOutputTokens',
      'gptTotalTokens',
      'externalId',
      'externalCreatedAt',
      'sourceMetadata',
      'direction',
      'redactionStatus',
      'redacted',
      'redactedSegments',
      'redactedAt',
      'originalBackupPath',
      'syncedAt',
    ];

    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      if (allowedFields.includes(key)) {
        // Map camelCase to snake_case for database columns
        const dbKey = key === 'processedAt' ? 'processed_at' 
                   : key === 'recordingUrl' ? 'recording_url'
                   : key === 'recordingSid' ? 'recording_sid'
                   : key === 'recordingPath' ? 'recording_path'
                   : key === 'recordingDeletedAt' ? 'recording_deleted_at'
                   : key === 'recordingDeletedReason' ? 'recording_deleted_reason'
                   : key === 'externalId' ? 'external_id'
                   : key === 'externalCreatedAt' ? 'external_created_at'
                   : key === 'sourceMetadata' ? 'source_metadata'
                   : key === 'gptModel' ? 'gpt_model'
                   : key === 'gptInputTokens' ? 'gpt_input_tokens'
                   : key === 'gptOutputTokens' ? 'gpt_output_tokens'
                   : key === 'gptTotalTokens' ? 'gpt_total_tokens'
                   : key === 'redactionStatus' ? 'redaction_status'
                   : key === 'redactedSegments' ? 'redacted_segments'
                   : key === 'redactedAt' ? 'redacted_at'
                   : key === 'originalBackupPath' ? 'original_backup_path'
                   : key === 'syncedAt' ? 'synced_at'
                   : key;
        fields.push(`${dbKey} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    });

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    // Handle userId - if null, don't filter by user_id (for system updates)
    let sql = `
      UPDATE calls
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
    `;
    
    if (userId !== null && userId !== undefined) {
      values.push(userId);
      sql += ` AND user_id = $${paramIndex + 1}`;
    }
    
    sql += ` RETURNING *`;

    const result = await query(sql, values);

    if (result.rows.length === 0) {
      throw new NotFoundError('Call');
    }

    return this.mapRowToCall(result.rows[0]);
  }

  static async delete(id, userId) {
    const result = await query(
      'DELETE FROM calls WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Call');
    }

    return true;
  }

  static async getStats(userId) {
    const statsResult = await query(
      `SELECT 
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_calls,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_calls
      FROM calls
      WHERE user_id = $1`,
      [userId]
    );

    const stats = statsResult.rows[0];

    // Get sentiment stats from call_metadata
    const sentimentResult = await query(
      `SELECT 
        COUNT(*) FILTER (WHERE sentiment = 'positive') as positive,
        COUNT(*) FILTER (WHERE sentiment = 'negative') as negative,
        COUNT(*) FILTER (WHERE sentiment = 'neutral') as neutral,
        COUNT(*) FILTER (WHERE urgent_topics IS NOT NULL AND array_length(urgent_topics, 1) > 0) as urgent
      FROM call_metadata cm
      INNER JOIN calls c ON cm.call_id = c.id
      WHERE c.user_id = $1`,
      [userId]
    );

    const sentiment = sentimentResult.rows[0];

    // Get recent calls
    const recentCalls = await this.findByUserId(userId, { limit: 5 });

    return {
      totalCalls: parseInt(stats.total_calls, 10),
      completedCalls: parseInt(stats.completed_calls, 10),
      failedCalls: parseInt(stats.failed_calls, 10),
      positiveSentiment: parseInt(sentiment.positive, 10),
      negativeSentiment: parseInt(sentiment.negative, 10),
      neutralSentiment: parseInt(sentiment.neutral, 10),
      urgentTopics: parseInt(sentiment.urgent, 10),
      recentCalls,
    };
  }

  static async findBySourceAndExternalId(source, externalId) {
    if (!externalId) return null;
    const result = await query(
      'SELECT * FROM calls WHERE source = $1 AND external_id = $2 LIMIT 1',
      [source, externalId]
    );
    if (result.rows.length === 0) {
      return null;
    }
    return this.mapRowToCall(result.rows[0]);
  }

  static async findLatestBySource(userId, source) {
    const result = await query(
      `SELECT * FROM calls 
       WHERE user_id = $1 AND source = $2 
       ORDER BY COALESCE(external_created_at, created_at) DESC 
       LIMIT 1`,
      [userId, source]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToCall(result.rows[0]);
  }

  static mapRowToCall(row) {
    return {
      id: row.id,
      userId: row.user_id,
      callSid: row.call_sid,
      recordingSid: row.recording_sid,
      callerNumber: row.caller_number,
      callerName: row.caller_name,
      transcript: row.transcript,
      analysis: row.analysis,
      recordingUrl: row.recording_url,
      recordingPath: row.recording_path,
      recordingDeletedAt: row.recording_deleted_at ? row.recording_deleted_at.toISOString() : null,
      recordingDeletedReason: row.recording_deleted_reason || null,
      status: row.status,
      duration: row.duration,
      source: row.source || CALL_SOURCE.TWILIO,
      gptModel: row.gpt_model || null,
      gptInputTokens: row.gpt_input_tokens ?? null,
      gptOutputTokens: row.gpt_output_tokens ?? null,
      gptTotalTokens: row.gpt_total_tokens ?? null,
      externalId: row.external_id,
      externalCreatedAt: row.external_created_at ? row.external_created_at.toISOString() : null,
      sourceMetadata: row.source_metadata || null,
      direction: row.direction || null,
      redactionStatus: row.redaction_status || null,
      redacted: Boolean(row.redacted),
      redactedSegments: row.redacted_segments || null,
      redactedAt: row.redacted_at ? row.redacted_at.toISOString() : null,
      originalBackupPath: row.original_backup_path || null,
      syncedAt: row.synced_at ? row.synced_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      processedAt: row.processed_at ? row.processed_at.toISOString() : null,
    };
  }

  /**
   * Delete a single call by ID
   */
  static async delete(id) {
    const result = await query(
      'DELETE FROM calls WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rows.length > 0;
  }

  /**
   * Bulk delete calls by IDs
   */
  static async bulkDelete(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return 0;
    }
    
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
    const result = await query(
      `DELETE FROM calls WHERE id IN (${placeholders}) RETURNING id`,
      ids
    );
    return result.rows.length;
  }

  /**
   * Count calls by source for a user
   */
  static async countBySource(userId, source) {
    const result = await query(
      'SELECT COUNT(*) as count FROM calls WHERE user_id = $1 AND source = $2',
      [userId, source]
    );
    return parseInt(result.rows[0]?.count || 0, 10);
  }

  /**
   * Count calls for a user with optional filters
   */
  static async countByUserId(userId, options = {}) {
    const { status, source, startDate, endDate } = options;

    let sql = 'SELECT COUNT(*) as count FROM calls WHERE user_id = $1';
    const params = [userId];
    let paramIndex = 2;

    if (status) {
      sql += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (source) {
      sql += ` AND source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }

    if (startDate) {
      sql += ` AND COALESCE(external_created_at, created_at) >= $${paramIndex}`;
      params.push(new Date(startDate));
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND COALESCE(external_created_at, created_at) <= $${paramIndex}`;
      params.push(new Date(endDate));
      paramIndex++;
    }

    const result = await query(sql, params);
    return parseInt(result.rows[0]?.count || 0, 10);
  }
}

