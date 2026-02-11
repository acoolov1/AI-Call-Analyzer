import { Client } from 'ssh2';
import { logger } from '../utils/logger.js';
import { FreePbxSshService } from './freepbx-ssh.service.js';

function shellEscapeSingleQuotes(value) {
  // Wrap in single quotes and escape internal single quotes safely for sh.
  // Example: abc'def -> 'abc'"'"'def'
  const str = String(value ?? '');
  return `'${str.replace(/'/g, `'\"'\"'`)}'`;
}

async function execWithTimeout(conn, command, timeoutMs = 120000) {
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

function sanitizeRecordingOverrides(value) {
  const obj =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const out = {};
  for (const [extKey, rawFlags] of Object.entries(obj)) {
    const ext = String(extKey || '').trim();
    if (!/^\d+$/.test(ext)) continue;
    if (!rawFlags || typeof rawFlags !== 'object' || Array.isArray(rawFlags)) continue;
    const flags = rawFlags;
    const entry = {};
    if (flags.inExternal === true) entry.inExternal = true;
    if (flags.outExternal === true) entry.outExternal = true;
    if (flags.inInternal === true) entry.inInternal = true;
    if (flags.outInternal === true) entry.outInternal = true;
    if (Object.keys(entry).length > 0) out[ext] = entry;
  }
  return out;
}

export class FreepbxRecordingOverridesService {
  /**
   * Apply per-extension recording overrides to FreePBX/Asterisk ASTDB.
   * Force=true -> database put ... force
   * Force=false/missing -> database del ... (Don't Care)
   */
  static async apply({ freepbxSettings, extensionNumbers, overrides }) {
    const numbers = Array.isArray(extensionNumbers)
      ? extensionNumbers.map((n) => String(n || '').trim()).filter((n) => /^\d+$/.test(n))
      : [];
    const desired = sanitizeRecordingOverrides(overrides);

    const sshConfig = FreePbxSshService.getSshConfig(freepbxSettings);
    const conn = new Client();

    const matrix = [
      { key: 'inExternal', path: 'in/external' },
      { key: 'outExternal', path: 'out/external' },
      { key: 'inInternal', path: 'in/internal' },
      { key: 'outInternal', path: 'out/internal' },
    ];

    const scriptLines = ['set -e'];
    let putCount = 0;
    let delCount = 0;

    for (const ext of numbers) {
      const flags = desired[ext] || {};
      for (const item of matrix) {
        if (flags[item.key] === true) {
          putCount += 1;
          scriptLines.push(
            `asterisk -rx "database put AMPUSER ${ext}/recording/${item.path} force" >/dev/null 2>&1`
          );
        } else {
          delCount += 1;
          // Explicitly write "dontcare" so FreePBX GUI shows "Don't Care" selected.
          // (Missing/empty also behaves like dontcare in dialplan, but the UI can look unselected.)
          scriptLines.push(
            `asterisk -rx "database put AMPUSER ${ext}/recording/${item.path} dontcare" >/dev/null 2>&1`
          );
        }
      }
    }

    const script = scriptLines.join('\n');
    const command = `bash -lc ${shellEscapeSingleQuotes(script)}`;

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

      // Timeout scales with number of commands, capped.
      const timeoutMs = Math.min(300000, 20000 + numbers.length * 250);
      await execWithTimeout(conn, command, timeoutMs);

      return {
        extensionCount: numbers.length,
        putCount,
        delCount,
      };
    } finally {
      try {
        conn.end();
      } catch (e) {
        logger.warn({ error: e?.message }, 'Failed to close SSH connection cleanly');
      }
    }
  }
}

