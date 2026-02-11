import mysql from 'mysql2/promise';
import { logger } from '../utils/logger.js';
import { FreePbxService } from './freepbx.service.js';
import { FreePbxSshService } from './freepbx-ssh.service.js';

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
      settings?.enabled !== false &&  // Check if explicitly disabled
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
        WHERE dstchannel IS NOT NULL
          AND dstchannel != ''
          AND lastapp = 'Dial'
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

      // FreePBX can emit multiple "Dial" legs for the same uniqueid (ring groups, multiple attempts).
      // When that happens, prefer the "best" leg so we don't ingest a NO ANSWER leg when an
      // ANSWERED leg exists for the same call.
      const bestRows = this.selectBestLegPerUniqueId(rows);

      return bestRows.map(row => this.normalizeCdrRow(row));
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to query CDR records');
      throw new Error(`Failed to query CDR records: ${error.message}`);
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  static selectBestLegPerUniqueId(rows) {
    const byId = new Map();

    const score = (row) => {
      const disposition = String(row?.disposition || '').toUpperCase().trim();
      const answered = disposition === 'ANSWERED';
      const hasRecording = Boolean(String(row?.recordingfile || '').trim());
      const billsec = Number(row?.billsec || 0);
      // Weighted preference: answered + recordingfile > answered > recordingfile > longer billsec.
      return (answered ? 1000 : 0) + (hasRecording ? 100 : 0) + Math.min(Math.max(billsec, 0), 60);
    };

    const compare = (a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa - sb;
      const seqA = Number(a?.sequence || 0);
      const seqB = Number(b?.sequence || 0);
      if (seqA !== seqB) return seqA - seqB;
      const ta = a?.calldate ? new Date(a.calldate).getTime() : 0;
      const tb = b?.calldate ? new Date(b.calldate).getTime() : 0;
      return ta - tb;
    };

    for (const row of rows) {
      const key = row?.uniqueid;
      if (!key) continue;
      const existing = byId.get(key);
      if (!existing) {
        byId.set(key, row);
        continue;
      }
      // Keep whichever compares higher
      if (compare(existing, row) < 0) {
        byId.set(key, row);
      }
    }

    return Array.from(byId.values());
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
    // Download via SSH/SFTP only
    const remotePath = FreePbxSshService.resolveRemotePath(recordingPath, freepbxSettings);
    return await FreePbxSshService.downloadRecording(remotePath, freepbxSettings);
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
        `SELECT COUNT(*) as total
         FROM cdr
         WHERE dstchannel IS NOT NULL
           AND dstchannel != ''
           AND lastapp = 'Dial'`
      );
      const total = countResult[0]?.total || 0;

      // Get paginated records
      const offset = (page - 1) * limit;
      const [rows] = await connection.execute(
        `SELECT * FROM cdr 
         WHERE dstchannel IS NOT NULL
           AND dstchannel != ''
           AND lastapp = 'Dial'
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

