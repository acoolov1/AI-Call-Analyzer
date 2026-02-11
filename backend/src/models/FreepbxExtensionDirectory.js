import { query } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';

export class FreepbxExtensionDirectory {
  static async getByUserId(userId) {
    const result = await query(
      `SELECT user_id, extensions, updated_at
       FROM freepbx_extension_directory
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return { userId, extensions: [], updatedAt: null };
    }
    const row = result.rows[0];
    return {
      userId: row.user_id,
      extensions: row.extensions || [],
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    };
  }

  static async upsert(userId, extensions) {
    const safe = Array.isArray(extensions) ? extensions : [];
    const result = await query(
      `INSERT INTO freepbx_extension_directory (user_id, extensions, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE
       SET extensions = EXCLUDED.extensions,
           updated_at = NOW()
       RETURNING user_id, extensions, updated_at`,
      [userId, JSON.stringify(safe)]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('FreePBX extension directory');
    }
    const row = result.rows[0];
    return {
      userId: row.user_id,
      extensions: row.extensions || [],
      updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
    };
  }

  static async getNameByExtension(userId, extensionNumber) {
    const ext = String(extensionNumber || '').trim();
    if (!ext) return null;
    const result = await query(
      `SELECT extensions
       FROM freepbx_extension_directory
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    if (result.rows.length === 0) return null;
    const list = Array.isArray(result.rows[0].extensions) ? result.rows[0].extensions : [];
    const match = list.find((e) => String(e?.number || '').trim() === ext);
    const name = match?.name ? String(match.name).trim() : '';
    return name || null;
  }

  static async getMapByUserId(userId) {
    const result = await query(
      `SELECT extensions
       FROM freepbx_extension_directory
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
    const map = new Map();
    if (result.rows.length === 0) return map;
    const list = Array.isArray(result.rows[0].extensions) ? result.rows[0].extensions : [];
    for (const e of list) {
      const number = String(e?.number || '').trim();
      const name = e?.name ? String(e.name).trim() : '';
      if (number) {
        map.set(number, name || null);
      }
    }
    return map;
  }
}

