import { Client } from 'ssh2';
import { logger } from '../utils/logger.js';
import { FreePbxSshService } from './freepbx-ssh.service.js';

const DEFAULT_BASE_PATH = '/var/spool/asterisk/monitor';

function parseDevicesOutput(output) {
  const items = [];
  const text = String(output || '').trim();
  if (!text) return items;
  for (const line of text.split('\n')) {
    const parts = line.trim().split('\t');
    const number = String(parts[0] || '').trim();
    if (!number) continue;
    const name = parts.length >= 2 ? String(parts[1] || '').trim() : '';
    items.push({ number, name: name || null });
  }
  return items;
}

function parsePjsipStatusOutput(output) {
  const statusMap = {};
  const text = String(output || '').trim();
  if (!text || text.includes('ERROR')) return statusMap;

  let currentEndpoint = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('Endpoint:')) {
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        const endpointPart = parts[1].split('/')[0];
        if (endpointPart.startsWith('<')) {
          currentEndpoint = null;
          continue;
        }
        currentEndpoint = endpointPart;
        // default offline, will switch to online if any Contact is Avail
        statusMap[currentEndpoint] = 'offline';
      }
      continue;
    }

    if (currentEndpoint && trimmed.startsWith('Contact:')) {
      const parts = trimmed.split(/\s+/);
      const idx = parts.findIndex((p) => p === 'Avail' || p === 'Available');
      if (idx >= 0) {
        statusMap[currentEndpoint] = 'online';
      }
    }
  }

  return statusMap;
}

async function execWithTimeout(conn, command, timeoutMs = 15000) {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        conn.end();
      } catch {}
      reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    conn.exec(command, { pty: false }, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return reject(err);
      }
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => {
          clearTimeout(timer);
          const out = (stdout || '').toString();
          const errText = (stderr || '').toString();
          // FreePBX sometimes writes warnings to stderr; treat non-zero as error.
          if (code && code !== 0) {
            return reject(new Error(errText.trim() || out.trim() || `SSH command failed (code ${code})`));
          }
          resolve({ stdout: out, stderr: errText });
        })
        .on('data', (data) => {
          stdout += data.toString('utf-8');
        });
      stream.stderr.on('data', (data) => {
        stderr += data.toString('utf-8');
      });
    });
  });
}

export class FreepbxExtensionsService {
  /**
   * One SSH connection: validate base path + fetch extensions with online/offline.
   * Uses the same SSH creds stored in the user's FreePBX Integration settings.
   */
  static async testAndFetchExtensions(settings) {
    const basePath = (settings?.ssh_base_path || DEFAULT_BASE_PATH).replace(/\/+$/, '');
    const sshConfig = FreePbxSshService.getSshConfig(settings);

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

      // 1) Base path exists? (used for recordings)
      const quotedBase = basePath.replace(/"/g, '\\"');
      const existsCmd = `bash -lc "if [ -d \\\"${quotedBase}\\\" ]; then echo 1; else echo 0; fi"`;
      const { stdout: existsOut } = await execWithTimeout(conn, existsCmd, 12000);
      const pathExists = String(existsOut).trim() === '1';

      // 2) Devices list (extension -> name)
      const devicesCmd =
        `mysql asterisk -sN -e "SELECT id, description FROM devices WHERE tech = 'pjsip' AND id REGEXP '^[0-9]+\\\\$' ORDER BY CAST(id AS UNSIGNED)" 2>&1`;
      const { stdout: devicesOut } = await execWithTimeout(conn, devicesCmd, 15000);

      // 3) Endpoint status list (online/offline)
      const statusCmd = `asterisk -rx "pjsip show endpoints" 2>&1`;
      const { stdout: statusOut } = await execWithTimeout(conn, statusCmd, 15000);

      const devices = parseDevicesOutput(devicesOut);
      const statusMap = parsePjsipStatusOutput(statusOut);

      const extensions = devices.map((d) => ({
        number: d.number,
        name: d.name || null,
        status: statusMap[d.number] || 'offline',
      }));

      return { ok: true, basePath, pathExists, extensions };
    } finally {
      try {
        conn.end();
      } catch (e) {
        logger.warn({ error: e?.message }, 'Failed to close SSH connection cleanly');
      }
    }
  }
}

