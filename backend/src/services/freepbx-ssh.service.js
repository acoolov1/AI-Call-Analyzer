import path from 'path';
import SftpClient from 'ssh2-sftp-client';
import { DateTime } from 'luxon';
import { logger } from '../utils/logger.js';

const DEFAULT_BASE_PATH = '/var/spool/asterisk/monitor';

function shellEscapeSingleQuotes(value) {
  // Wrap in single quotes and escape internal single quotes safely for sh.
  // Example: abc'def -> 'abc'"'"'def'
  const str = String(value ?? '');
  return `'${str.replace(/'/g, `'\"'\"'`)}'`;
}

export class FreePbxSshService {
  static resolveRemotePath(recordingPath, settings) {
    if (!recordingPath) {
      throw new Error('Recording path is required for SSH download');
    }

    const basePath = settings?.ssh_base_path || DEFAULT_BASE_PATH;
    const trimmedBase = basePath.replace(/\/+$/, '');
    const normalizedInput = recordingPath.replace(/^\/+/, '');

    // If absolute path is already provided (or already under base), use as-is
    if (recordingPath.startsWith('/')) {
      return recordingPath;
    }
    if (normalizedInput.startsWith(trimmedBase.replace(/^\/+/, ''))) {
      return `/${normalizedInput}`;
    }

    return this.buildTargetPath(normalizedInput, trimmedBase);
  }

  static buildTargetPath(recordingPath, basePath = DEFAULT_BASE_PATH) {
    if (!recordingPath) {
      throw new Error('Recording path is required for SSH upload');
    }

    let clean = recordingPath.replace(/^\/+/, '');
    clean = clean.replace(/^monitor\//, '');

    const ext = path.posix.extname(clean) || '.wav';
    const nameWithoutExt = ext ? clean.slice(0, clean.length - ext.length) : clean;
    const baseName = path.posix.basename(nameWithoutExt) + (ext.startsWith('.') ? ext : `.wav`);

    const dateMatch = nameWithoutExt.match(/-(\d{8})-\d{6}-/);
    if (dateMatch) {
      const dateStr = dateMatch[1];
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      return path.posix.join(basePath.replace(/\/+$/, ''), year, month, day, baseName);
    }

    return path.posix.join(basePath.replace(/\/+$/, ''), clean);
  }

  static getSshConfig(settings) {
    if (!settings?.ssh_host || !settings?.ssh_username) {
      throw new Error('SSH host and username are required for FreePBX upload');
    }

    const config = {
      host: settings.ssh_host,
      port: Number(settings.ssh_port) || 22,
      username: settings.ssh_username,
      readyTimeout: 15000,
    };

    if (settings.ssh_private_key) {
      config.privateKey = Buffer.from(settings.ssh_private_key, 'utf-8');
      if (settings.ssh_passphrase) {
        config.passphrase = settings.ssh_passphrase;
      }
    } else if (settings.ssh_password) {
      config.password = settings.ssh_password;
    } else {
      throw new Error('SSH password or private key is required for FreePBX upload');
    }

    return config;
  }

  /**
   * Upload a redacted recording and replace the original.
   * Strategy: delete original first, then upload new file directly.
   */
  static async uploadAndReplace(buffer, recordingPath, settings) {
    const sftp = new SftpClient();
    const targetPath = this.buildTargetPath(recordingPath, settings?.ssh_base_path || DEFAULT_BASE_PATH);
    const remoteDir = path.posix.dirname(targetPath);
    const tempPath = path.posix.join(remoteDir, `.tmp-redacted-${Date.now()}-${path.posix.basename(targetPath)}`);

    try {
      const config = this.getSshConfig(settings);
      await sftp.connect(config);
      await sftp.mkdir(remoteDir, true);
      
      // Upload to temp location first
      await sftp.put(buffer, tempPath);
      
      // Delete original and rename temp (direct approach)
      await sftp.delete(targetPath);
      await sftp.rename(tempPath, targetPath);
      logger.info({ targetPath }, 'Audio overwritten via delete+rename');
      
      return { targetPath, method: 'delete+rename' };
    } catch (error) {
      logger.error({ error: error.message, recordingPath, targetPath }, 'SSH upload/replace failed');
      
      // Cleanup temp file if it exists
      try {
        if (sftp) {
          await sftp.delete(tempPath);
        }
      } catch (cleanupErr) {
        // Ignore cleanup errors
      }
      
      throw new Error(`SSH upload failed: ${error.message}`);
    } finally {
      try {
        if (sftp) {
          await sftp.end();
        }
      } catch (cleanupErr) {
        logger.warn({ error: cleanupErr.message }, 'Failed to close SFTP connection cleanly');
      }
    }
  }

  static async testConnection(settings) {
    const sftp = new SftpClient();
    const basePath = settings?.ssh_base_path || DEFAULT_BASE_PATH;
    try {
      const config = this.getSshConfig(settings);
      await sftp.connect(config);
      const exists = await sftp.exists(basePath.replace(/\/+$/, ''));
      return { ok: true, pathExists: Boolean(exists), basePath };
    } catch (error) {
      logger.error({ error: error.message }, 'SSH test connection failed');
      throw new Error(`SSH test failed: ${error.message}`);
    } finally {
      try {
        await sftp.end();
      } catch (cleanupErr) {
        logger.warn({ error: cleanupErr.message }, 'Failed to close SFTP after test');
      }
    }
  }

  static async getFolderStats(settings) {
    const basePath = (settings?.ssh_base_path || DEFAULT_BASE_PATH).replace(/\/+$/, '');
    const quotedBase = shellEscapeSingleQuotes(basePath);
    const sshConfig = this.getSshConfig(settings);

    // Use SSH exec for fast server-side counting (avoid slow recursive SFTP listing).
    const { Client } = await import('ssh2');

    const execWithTimeout = (conn, command, timeoutMs = 25000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          try {
            conn.end();
          } catch {}
          reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          let stdout = '';
          let stderr = '';
          stream
            .on('close', (code) => {
              clearTimeout(timer);
              if (code && code !== 0 && stderr) {
                return reject(new Error(stderr.trim()));
              }
              resolve({ stdout, stderr });
            })
            .on('data', (data) => {
              stdout += data.toString('utf-8');
            });
          stream.stderr.on('data', (data) => {
            stderr += data.toString('utf-8');
          });
        });
      });

    const conn = new Client();
    try {
      await new Promise((resolve, reject) => {
        conn
          .on('ready', resolve)
          .on('error', reject)
          .connect({
            ...sshConfig,
            // ssh2 expects string for privateKey too; Buffer works, but be explicit.
            privateKey: sshConfig.privateKey,
          });
      });

      // 1) File count
      const countCmd = `bash -lc "if [ -d ${quotedBase} ]; then find ${quotedBase} -type f 2>/dev/null | wc -l; else echo 0; fi"`;
      const { stdout: countOut } = await execWithTimeout(conn, countCmd);
      const fileCount = Number.parseInt(String(countOut).trim(), 10) || 0;

      // 2) Total size
      // Prefer bytes if du supports -b; fallback to KB.
      const duBytesCmd = `bash -lc "if command -v du >/dev/null 2>&1; then du -sb ${quotedBase} 2>/dev/null | awk '{print \\$1}'; fi"`;
      const { stdout: duBytesOut } = await execWithTimeout(conn, duBytesCmd);
      let totalBytes = Number.parseInt(String(duBytesOut).trim(), 10);

      if (!Number.isFinite(totalBytes) || totalBytes < 0) {
        const duKbCmd = `bash -lc "if command -v du >/dev/null 2>&1; then du -sk ${quotedBase} 2>/dev/null | awk '{print \\$1}'; fi"`;
        const { stdout: duKbOut } = await execWithTimeout(conn, duKbCmd);
        const totalKb = Number.parseInt(String(duKbOut).trim(), 10);
        totalBytes = Number.isFinite(totalKb) && totalKb >= 0 ? totalKb * 1024 : 0;
      }

      // 3) First/last day directory (YYYY/MM/DD) under base path
      const dayGlob = `${quotedBase}/[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]`;
      const firstCmd = `bash -lc "ls -d ${dayGlob} 2>/dev/null | sort | head -n 1"`;
      const lastCmd = `bash -lc "ls -d ${dayGlob} 2>/dev/null | sort | tail -n 1"`;
      const [{ stdout: firstOut }, { stdout: lastOut }] = await Promise.all([
        execWithTimeout(conn, firstCmd),
        execWithTimeout(conn, lastCmd),
      ]);

      const parseYmdFromPath = (p) => {
        const s = String(p || '').trim();
        if (!s) return null;
        const parts = s.split('/').filter(Boolean);
        if (parts.length < 3) return null;
        const [y, m, d] = parts.slice(-3);
        if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return null;
        return `${y}-${m}-${d}`;
      };

      const firstDay = parseYmdFromPath(firstOut);
      const lastDay = parseYmdFromPath(lastOut);

      const sizeMB = Math.round((totalBytes / (1024 * 1024)) * 10) / 10;

      return {
        basePath,
        fileCount,
        totalBytes,
        sizeMB,
        firstDay,
        lastDay,
      };
    } finally {
      try {
        conn.end();
      } catch {}
    }
  }

  static async deleteOldRecordingsByDays(settings, days, options = {}) {
    const retentionDays = Number(days);
    if (!Number.isFinite(retentionDays) || retentionDays < 1) {
      throw new Error('retention days must be a number >= 1');
    }

    // Retention is based on the YYYY/MM/DD folder structure (not file mtime),
    // because mtimes can be unreliable after restores/uploads.
    // Keep the most recent N calendar days (inclusive) in the provided timezone.
    const tz = typeof options?.timezone === 'string' && options.timezone.trim() ? options.timezone.trim() : 'UTC';
    const keepFrom = DateTime.now().setZone(tz).startOf('day').minus({ days: Math.floor(retentionDays) - 1 });
    const keepFromYmdPath = keepFrom.isValid
      ? keepFrom.toFormat('yyyy/LL/dd')
      : DateTime.utc().startOf('day').minus({ days: Math.floor(retentionDays) - 1 }).toFormat('yyyy/LL/dd');

    const basePath = (settings?.ssh_base_path || DEFAULT_BASE_PATH).replace(/\/+$/, '');
    const quotedBase = shellEscapeSingleQuotes(basePath);
    const sshConfig = this.getSshConfig(settings);
    const { Client } = await import('ssh2');

    const execWithTimeout = (conn, command, timeoutMs = 120000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          try {
            conn.end();
          } catch {}
          reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            return reject(err);
          }
          let stdout = '';
          let stderr = '';
          stream
            .on('close', (code) => {
              clearTimeout(timer);
              if (code && code !== 0 && stderr) {
                return reject(new Error(stderr.trim()));
              }
              resolve({ stdout, stderr });
            })
            .on('data', (data) => {
              stdout += data.toString('utf-8');
            });
          stream.stderr.on('data', (data) => {
            stderr += data.toString('utf-8');
          });
        });
      });

    const conn = new Client();
    try {
      await new Promise((resolve, reject) => {
        conn
          .on('ready', resolve)
          .on('error', reject)
          .connect({
            ...sshConfig,
            privateKey: sshConfig.privateKey,
          });
      });

      const keepFullPath = `${basePath}/${keepFromYmdPath}`;
      const quotedKeep = shellEscapeSingleQuotes(keepFullPath);
      const dayGlob = `${quotedBase}/[0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]`;

      // Count candidates first (useful for logging/UI).
      const audioNameFilter = `\\( -name '*.wav' -o -name '*.WAV' -o -name '*.mp3' -o -name '*.MP3' -o -name '*.gsm' -o -name '*.GSM' \\)`;
      const countCmd =
        `bash -lc "if [ -d ${quotedBase} ]; then ` +
        `ls -d ${dayGlob} 2>/dev/null | sort | awk -v keep=${quotedKeep} '\\$0 < keep {print}' ` +
        `| xargs -r -I{} find \\\"{}\\\" -type f ${audioNameFilter} 2>/dev/null ` +
        `| wc -l; else echo 0; fi"`;
      const { stdout: countOut } = await execWithTimeout(conn, countCmd, 120000);
      const candidateFiles = Number.parseInt(String(countOut || '').trim(), 10) || 0;

      // Delete old day directories (YYYY/MM/DD) older than keepFullPath, then remove empty parents.
      const deleteCmd =
        `bash -lc "if [ -d ${quotedBase} ]; then ` +
        `ls -d ${dayGlob} 2>/dev/null | sort | awk -v keep=${quotedKeep} '\\$0 < keep {print}' | xargs -r rm -rf; ` +
        `find ${quotedBase} -type d -empty -delete 2>/dev/null; ` +
        `echo ok; else echo ok; fi"`;
      await execWithTimeout(conn, deleteCmd, 10 * 60 * 1000);

      return {
        basePath,
        candidateFiles,
        retentionDays: Math.floor(retentionDays),
        keepFromYmdPath,
      };
    } finally {
      try {
        conn.end();
      } catch {}
    }
  }

  static async downloadRecording(recordingPath, settings) {
    const sftp = new SftpClient();
    const remotePath = this.resolveRemotePath(recordingPath, settings);

    try {
      const config = this.getSshConfig(settings);
      await sftp.connect(config);
      const result = await sftp.get(remotePath);
      return Buffer.isBuffer(result) ? result : Buffer.from(result);
    } catch (error) {
      logger.error({ error: error.message, recordingPath, remotePath }, 'SSH download failed');
      throw new Error(`SSH download failed: ${error.message}`);
    } finally {
      try {
        await sftp.end();
      } catch (cleanupErr) {
        logger.warn({ error: cleanupErr.message }, 'Failed to close SFTP after download');
      }
    }
  }
}


