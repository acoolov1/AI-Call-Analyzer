import { query } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';

export const VOICEMAIL_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export class VoicemailMessage {
  static mapRow(row) {
    return {
      id: row.id,
      userId: row.user_id,
      mailbox: row.mailbox,
      vmContext: row.vm_context,
      folder: row.folder,
      msgId: row.msg_id,
      receivedAt: row.received_at ? row.received_at.toISOString() : null,
      callerId: row.caller_id || '',
      durationSeconds: row.duration_seconds ?? null,
      recordingPath: row.recording_path || null,
      metadataPath: row.metadata_path || null,
      pbxIdentity: row.pbx_identity || null,
      lastSeenAt: row.last_seen_at ? row.last_seen_at.toISOString() : null,
      listenedAt: row.listened_at ? row.listened_at.toISOString() : null,
      transcript: row.transcript || '',
      analysis: row.analysis || '',
      status: row.status || VOICEMAIL_STATUS.PENDING,
      processedAt: row.processed_at ? row.processed_at.toISOString() : null,
      error: row.error || null,
      createdAt: row.created_at ? row.created_at.toISOString() : null,
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    };
  }

  static async upsertDiscovery(data) {
    const {
      userId,
      mailbox,
      vmContext = 'default',
      folder = 'INBOX',
      msgId,
      receivedAt = null,
      callerId = null,
      durationSeconds = null,
      recordingPath = null,
      metadataPath = null,
      pbxIdentity = null,
    } = data;

    const safeIdentity = pbxIdentity != null && String(pbxIdentity).trim() ? String(pbxIdentity).trim() : null;
    const safeMetadataPath = metadataPath ? String(metadataPath) : null;

    // Single upsert on (user_id, vm_context, mailbox, folder, msg_id) to avoid duplicate-key
    // when a row already exists (e.g. with pbx_identity NULL) and we insert with pbx_identity set.
    const sql = `
      INSERT INTO voicemail_messages (
        user_id, mailbox, vm_context, folder, msg_id,
        received_at, caller_id, duration_seconds, recording_path,
        metadata_path, pbx_identity, last_seen_at,
        status, created_at, updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),'pending',NOW(),NOW())
      ON CONFLICT (user_id, vm_context, mailbox, folder, msg_id)
      DO UPDATE SET
        received_at = COALESCE(EXCLUDED.received_at, voicemail_messages.received_at),
        caller_id = COALESCE(EXCLUDED.caller_id, voicemail_messages.caller_id),
        duration_seconds = COALESCE(EXCLUDED.duration_seconds, voicemail_messages.duration_seconds),
        recording_path = COALESCE(EXCLUDED.recording_path, voicemail_messages.recording_path),
        metadata_path = COALESCE(EXCLUDED.metadata_path, voicemail_messages.metadata_path),
        pbx_identity = COALESCE(EXCLUDED.pbx_identity, voicemail_messages.pbx_identity),
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING *;
    `;

    const params = [
      userId,
      String(mailbox),
      String(vmContext),
      String(folder),
      String(msgId),
      receivedAt ? new Date(receivedAt) : null,
      callerId,
      durationSeconds,
      recordingPath,
      safeMetadataPath,
      safeIdentity,
    ];

    const result = await query(sql, params);

    return this.mapRow(result.rows[0]);
  }

  static async findById(id, userId = null) {
    let sql = 'SELECT * FROM voicemail_messages WHERE id = $1';
    const params = [id];
    if (userId) {
      sql += ' AND user_id = $2';
      params.push(userId);
    }
    const result = await query(sql, params);
    if (result.rows.length === 0) throw new NotFoundError('VoicemailMessage');
    return this.mapRow(result.rows[0]);
  }

  static async listByMailbox({ userId, mailbox, vmContext = 'default', folders = ['INBOX', 'Old'], limit = 50, offset = 0 }) {
    const safeFolders = Array.isArray(folders) && folders.length ? folders.map(String) : ['INBOX'];
    const result = await query(
      `
      SELECT *
      FROM voicemail_messages
      WHERE user_id = $1
        AND mailbox = $2
        AND vm_context = $3
        AND folder = ANY($4::text[])
      ORDER BY received_at DESC NULLS LAST, created_at DESC
      LIMIT $5 OFFSET $6
      `,
      [userId, String(mailbox), String(vmContext), safeFolders, Number(limit) || 50, Number(offset) || 0]
    );
    return result.rows.map(this.mapRow);
  }

  static async listMailboxesWithCounts({ userId, vmContext = 'default' }) {
    const result = await query(
      `
      SELECT mailbox,
             COUNT(*)::int as total,
             SUM(CASE WHEN folder = 'INBOX' AND listened_at IS NULL THEN 1 ELSE 0 END)::int as inbox_count,
             SUM(CASE WHEN folder = 'Old' OR listened_at IS NOT NULL THEN 1 ELSE 0 END)::int as old_count,
             MAX(received_at) as last_received_at
      FROM voicemail_messages
      WHERE user_id = $1
        AND vm_context = $2
      GROUP BY mailbox
      ORDER BY last_received_at DESC NULLS LAST, mailbox ASC
      `,
      [userId, String(vmContext)]
    );
    return result.rows.map((r) => ({
      mailbox: r.mailbox,
      total: r.total || 0,
      inboxCount: r.inbox_count || 0,
      oldCount: r.old_count || 0,
      lastReceivedAt: r.last_received_at ? r.last_received_at.toISOString() : null,
    }));
  }

  static async update(id, userId, updates = {}) {
    const allowed = [
      'transcript',
      'analysis',
      'status',
      'processedAt',
      'error',
      'recordingPath',
      'metadataPath',
      'folder',
      'msgId',
      'durationSeconds',
      'callerId',
      'receivedAt',
      'listenedAt',
    ];
    const setClauses = [];
    const params = [];
    let idx = 1;

    for (const key of allowed) {
      if (updates[key] === undefined) continue;
      const dbKey =
        key === 'processedAt' ? 'processed_at' :
        key === 'recordingPath' ? 'recording_path' :
        key === 'metadataPath' ? 'metadata_path' :
        key === 'durationSeconds' ? 'duration_seconds' :
        key === 'callerId' ? 'caller_id' :
        key === 'receivedAt' ? 'received_at' :
        key === 'listenedAt' ? 'listened_at' :
        key === 'msgId' ? 'msg_id' :
        key;
      setClauses.push(`${dbKey} = $${idx}`);
      const v = updates[key];
      if (key === 'processedAt' || key === 'receivedAt' || key === 'listenedAt') {
        params.push(v ? new Date(v) : null);
      } else {
        params.push(v);
      }
      idx++;
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id);
    const idIdx = idx++;
    let sql = `UPDATE voicemail_messages SET ${setClauses.join(', ')} WHERE id = $${idIdx}`;
    if (userId) {
      params.push(userId);
      sql += ` AND user_id = $${idx++}`;
    }
    sql += ' RETURNING *';

    const result = await query(sql, params);
    if (result.rows.length === 0) throw new NotFoundError('VoicemailMessage');
    return this.mapRow(result.rows[0]);
  }

  static async deleteById(id, userId = null) {
    let sql = 'DELETE FROM voicemail_messages WHERE id = $1';
    const params = [id];
    if (userId) {
      sql += ' AND user_id = $2';
      params.push(userId);
    }
    await query(sql, params);
    return true;
  }

  /** Delete any row with same (user, context, mailbox, folder, msg_id) but different id. Used before updating a row to folder=Old to avoid unique constraint violation. */
  static async deleteByUserMailboxFolderMsgIdExcept(userId, vmContext, mailbox, folder, msgId, exceptId) {
    const sql = `
      DELETE FROM voicemail_messages
      WHERE user_id = $1 AND vm_context = $2 AND mailbox = $3 AND folder = $4 AND msg_id = $5 AND id != $6
    `;
    await query(sql, [userId, String(vmContext), String(mailbox), String(folder), String(msgId), exceptId]);
    return true;
  }
}

