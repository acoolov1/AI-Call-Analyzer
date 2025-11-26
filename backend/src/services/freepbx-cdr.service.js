import mysql from 'mysql2/promise';
import { logger } from '../utils/logger.js';
import { CALL_SOURCE } from '../utils/constants.js';
import { FreePbxService } from './freepbx.service.js';

export class FreePbxCdrService {
  // Timezone offset mapping (hours from UTC)
  static TIMEZONE_OFFSETS = {
    'America/New_York': -5,     // EST
    'America/Chicago': -6,       // CST
    'America/Denver': -7,        // MST
    'America/Los_Angeles': -8,   // PST
    'America/Anchorage': -9,     // AKST
    'Pacific/Honolulu': -10,     // HST
    'UTC': 0,
  };

  static getTimezoneOffset(timezone) {
    return this.TIMEZONE_OFFSETS[timezone] || -5; // Default to EST if unknown
  }

  static isEnabled(settings) {
    return Boolean(
      settings?.enabled &&
      settings?.mysql_host &&
      settings?.mysql_username &&
      settings?.mysql_password
    );
  }

  static normalizeMysqlSettings(freepbxSettings) {
    return {
      host: freepbxSettings?.mysql_host || freepbxSettings?.host,
      port: freepbxSettings?.mysql_port || 3306,
      user: freepbxSettings?.mysql_username,
      password: freepbxSettings?.mysql_password,
      database: freepbxSettings?.mysql_database || 'asteriskcdrdb',
      dateStrings: true, // Return DATE/DATETIME as strings, not Date objects
    };
  }

  static async createConnection(freepbxSettings) {
    if (!this.isEnabled(freepbxSettings)) {
      throw new Error('FreePBX CDR integration is not configured');
    }

    const mysqlConfig = this.normalizeMysqlSettings(freepbxSettings);
    
    try {
      const connection = await mysql.createConnection(mysqlConfig);
      return connection;
    } catch (error) {
      logger.error({ error: error.message, host: mysqlConfig.host }, 'Failed to connect to MySQL');
      throw new Error(`Failed to connect to MySQL: ${error.message}`);
    }
  }

  static async testConnection(freepbxSettings) {
    let connection;
    try {
      connection = await this.createConnection(freepbxSettings);
      const [rows] = await connection.execute('SELECT COUNT(*) as count FROM cdr LIMIT 1');
      return {
        ok: true,
        recordCount: rows[0]?.count || 0,
      };
    } catch (error) {
      logger.error({ error: error.message }, 'MySQL connection test failed');
      throw new Error(`Failed to test MySQL connection: ${error.message}`);
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  static async listCdrRecords({ since, limit = 1000, freepbxSettings, userTimezone }) {
    if (!this.isEnabled(freepbxSettings)) {
      throw new Error('FreePBX CDR integration is not configured');
    }

    let connection;
    try {
      connection = await this.createConnection(freepbxSettings);
      
      let sql = `
        SELECT 
          uniqueid,
          calldate,
          clid,
          src,
          dst,
          dcontext,
          channel,
          dstchannel,
          lastapp,
          lastdata,
          duration,
          billsec,
          disposition,
          accountcode,
          userfield,
          did,
          recordingfile,
          cnum,
          cnam,
          outbound_cnum,
          outbound_cnam,
          dst_cnam,
          linkedid,
          peeraccount,
          sequence
        FROM cdr
        WHERE disposition = 'ANSWERED'
      `;

      const params = [];
      
      if (since) {
        // Convert UTC timestamp to MySQL datetime format using the user's timezone
        // since is in UTC (e.g., "2025-11-25T18:38:23.000Z")
        // We need to convert to the user's local time for MySQL comparison
        const tz = userTimezone || 'America/New_York';
        const tzOffset = this.getTimezoneOffset(tz); // Hours from UTC
        
        const sinceDate = new Date(since);
        // Convert from UTC to local time
        const localDate = new Date(sinceDate.getTime() + (tzOffset * 60 * 60 * 1000));
        // Format as MySQL datetime: YYYY-MM-DD HH:MM:SS
        const mysqlDatetime = localDate.toISOString()
          .replace('T', ' ')
          .replace(/\.\d{3}Z$/, '');
        
        sql += ' AND calldate > ?';
        params.push(mysqlDatetime);
        console.log(`🔍 CDR Query filtering by: calldate > "${mysqlDatetime}" (converted from UTC: ${since}, user timezone: ${tz})`);
      } else {
        console.log(`🔍 CDR Query fetching ALL calls (no since filter)`);
      }

      sql += ' ORDER BY calldate DESC LIMIT ?';
      params.push(limit);
      
      console.log(`📊 Full SQL query:`, sql.replace(/\s+/g, ' '));

      const [rows] = await connection.execute(sql, params);
      
      if (rows.length > 0) {
        console.log(`📅 Sample CDR calldate from MySQL: "${rows[0].calldate}"`);
      }
      
      return rows.map(row => this.normalizeCdrRow(row));
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to query CDR records');
      throw new Error(`Failed to query CDR records: ${error.message}`);
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  static normalizeCdrRow(row) {
    return {
      uniqueid: row.uniqueid,
      calldate: row.calldate,
      callerNumber: row.cnum || row.src,
      callerName: row.cnam || null,
      calleeNumber: row.dst,
      calleeName: row.dst_cnam || null,
      duration: row.duration,
      billsec: row.billsec,
      disposition: row.disposition,
      recordingfile: row.recordingfile,
      channel: row.channel,
      dstchannel: row.dstchannel,
      did: row.did,
      linkedid: row.linkedid,
      rawCdr: row,
    };
  }

  static async downloadRecording(recordingPath, freepbxSettings) {
    // CDR stores: external-200-+17173815064-20251123-203354-1763948034.15.wav
    // ARI expects: 2025/11/23/external-200-+17173815064-20251123-203354-1763948034.15
    
    // Remove extension
    let cleanPath = recordingPath.replace(/\.(wav|gsm|mp3)$/i, '');
    
    // Extract date from filename (format: ...YYYYMMDD-HHMMSS-...)
    const dateMatch = cleanPath.match(/-(\d{8})-\d{6}-/);
    if (dateMatch) {
      const dateStr = dateMatch[1]; // e.g., "20251123"
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      
      // Construct full path WITHOUT monitor prefix: YYYY/MM/DD/filename
      // ARI list shows recordings as: "2025/11/23/external-200-..."
      const ariPath = `${year}/${month}/${day}/${cleanPath}`;
      return await FreePbxService.downloadRecording(ariPath, freepbxSettings);
    }
    
    // Fallback if date extraction fails - try as-is
    return await FreePbxService.downloadRecording(cleanPath, freepbxSettings);
  }

  static async getCdrCalls({ page = 1, limit = 50, userId, freepbxSettings }) {
    if (!this.isEnabled(freepbxSettings)) {
      return { calls: [], total: 0, page, limit };
    }

    let connection;
    try {
      connection = await this.createConnection(freepbxSettings);
      
      // Get total count
      const [countResult] = await connection.execute(
        'SELECT COUNT(*) as total FROM cdr WHERE disposition = "ANSWERED"'
      );
      const total = countResult[0]?.total || 0;

      // Get paginated records
      const offset = (page - 1) * limit;
      const [rows] = await connection.execute(
        `SELECT * FROM cdr 
         WHERE disposition = 'ANSWERED' 
         ORDER BY calldate DESC 
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );

      const calls = rows.map(row => this.normalizeCdrRow(row));

      return {
        calls,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to get paginated CDR calls');
      throw new Error(`Failed to get CDR calls: ${error.message}`);
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }
}

