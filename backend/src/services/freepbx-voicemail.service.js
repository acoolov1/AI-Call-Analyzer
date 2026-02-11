import { logger } from '../utils/logger.js';
import { FreePbxSshService } from './freepbx-ssh.service.js';

const DEFAULT_VOICEMAIL_BASE_PATH = '/var/spool/asterisk/voicemail';
const DEFAULT_VOICEMAIL_CONTEXT = 'default';

function shellEscapeSingleQuotes(value) {
  const str = String(value ?? '');
  return `'${str.replace(/'/g, `'\"'\"'`)}'`;
}

function parseKeyValueTxt(txt) {
  const out = {};
  const lines = String(txt || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = val;
  }
  return out;
}

export class FreePbxVoicemailService {
  static getVoicemailConfig(freepbxSettings = {}) {
    const basePath = String(freepbxSettings.voicemail_base_path || DEFAULT_VOICEMAIL_BASE_PATH).replace(/\/+$/, '');
    const context = String(freepbxSettings.voicemail_context || DEFAULT_VOICEMAIL_CONTEXT).trim() || DEFAULT_VOICEMAIL_CONTEXT;
    const foldersRaw = freepbxSettings.voicemail_folders;
    const folders = Array.isArray(foldersRaw) && foldersRaw.length ? foldersRaw.map(String) : ['INBOX', 'Old'];
    return { basePath, context, folders };
  }

  static async execWithTimeout(conn, command, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
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
  }

  static async withSshConn(freepbxSettings, fn) {
    const sshConfig = FreePbxSshService.getSshConfig(freepbxSettings);
    const { Client } = await import('ssh2');
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
      return await fn(conn);
    } finally {
      try {
        conn.end();
      } catch {}
    }
  }

  /**
   * Returns a list of mailboxes that currently have voicemail messages.
   * Output items include per-folder counts and latest origtime.
   */
  static async listMailboxes(freepbxSettings) {
    const { basePath, context, folders } = this.getVoicemailConfig(freepbxSettings);
    const root = `${basePath}/${context}`.replace(/\/+$/, '');
    const quotedRoot = shellEscapeSingleQuotes(root);

    // Find msg####.txt and return raw (mailbox|folder|origtime) lines.
    // We'll aggregate in JS to avoid complex awk quoting.
    const foldersSafe = folders
      .map((f) => String(f).replace(/[^A-Za-z0-9_-]/g, ''))
      .filter(Boolean);
    const folderAlternation = (foldersSafe.length ? foldersSafe : ['INBOX', 'Old']).join('|');

    // Output lines: mailbox|folder|origtime
    const cmd =
      `bash -lc 'root=${quotedRoot}; ` +
      `if [ -d "$root" ]; then ` +
      `  find "$root" -type f -name "msg*.txt" 2>/dev/null ` +
      `  | while IFS= read -r file; do ` +
      `      folder=$(basename "$(dirname "$file")"); ` +
      `      case "$folder" in ${folderAlternation}) ;; *) continue ;; esac; ` +
      `      mb=$(basename "$(dirname "$(dirname "$file")")"); ` +
      `      ot=$(grep -m1 "^origtime=" "$file" 2>/dev/null | cut -d= -f2); ` +
      `      [ -z "$ot" ] && ot=0; ` +
      `      printf "%s|%s|%s\\n" "$mb" "$folder" "$ot"; ` +
      `    done ` +
      `else echo ""; fi'`;

    return await this.withSshConn(freepbxSettings, async (conn) => {
      const { stdout } = await this.execWithTimeout(conn, cmd, 45000);
      const lines = String(stdout || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const byMailbox = new Map();
      for (const line of lines) {
        const [mailbox, folder, origtimeStr] = line.split('|');
        if (!mailbox) continue;
        const origtime = Number.parseInt(origtimeStr || '0', 10) || 0;
        const current = byMailbox.get(mailbox) || { mailbox, counts: {}, lastOrigTime: 0 };
        current.counts[folder] = (current.counts[folder] || 0) + 1;
        current.lastOrigTime = Math.max(current.lastOrigTime || 0, origtime || 0);
        byMailbox.set(mailbox, current);
      }

      const out = Array.from(byMailbox.values()).map((m) => ({
        mailbox: m.mailbox,
        counts: m.counts,
        lastReceivedAt: m.lastOrigTime ? new Date(m.lastOrigTime * 1000).toISOString() : null,
      }));

      // Sort by lastReceivedAt desc then mailbox asc.
      out.sort((a, b) => {
        const at = a.lastReceivedAt ? new Date(a.lastReceivedAt).getTime() : 0;
        const bt = b.lastReceivedAt ? new Date(b.lastReceivedAt).getTime() : 0;
        if (bt !== at) return bt - at;
        return String(a.mailbox).localeCompare(String(b.mailbox));
      });
      return out;
    });
  }

  /**
   * List voicemail messages for a mailbox across configured folders.
   * Parses msg####.txt and selects best audio (wav, WAV, gsm).
   */
  static async listMessagesForMailbox(freepbxSettings, { mailbox }) {
    const { basePath, context, folders } = this.getVoicemailConfig(freepbxSettings);
    const mb = String(mailbox || '').trim();
    if (!mb) throw new Error('mailbox is required');

    const mailboxDir = `${basePath}/${context}/${mb}`.replace(/\/+$/, '');
    const quotedMailboxDir = shellEscapeSingleQuotes(mailboxDir);
    const foldersSafe = folders
      .map((f) => String(f).replace(/[^A-Za-z0-9_-]/g, ''))
      .filter(Boolean);
    const folderList = foldersSafe.length ? foldersSafe : ['INBOX', 'Old'];

    // Emit one line per message (TAB-separated to reduce delimiter issues):
    // folder \t msgId \t origtime \t duration \t callerid \t audiopath \t metapath
    const cmd =
      `bash -lc 'base=${quotedMailboxDir}; ` +
      `if [ -d "$base" ]; then ` +
      `  for folder in ${folderList.map((f) => `'${f}'`).join(' ')}; do ` +
      `    dir="$base/$folder"; ` +
      `    [ -d "$dir" ] || continue; ` +
      `    for f in "$dir"/msg*.txt; do ` +
      `      [ -f "$f" ] || continue; ` +
      `      msg=$(basename "$f" .txt); ` +
      `      ot=$(grep -m1 "^origtime=" "$f" 2>/dev/null | cut -d= -f2); [ -z "$ot" ] && ot=0; ` +
      `      dur=$(grep -m1 "^duration=" "$f" 2>/dev/null | cut -d= -f2); [ -z "$dur" ] && dur=0; ` +
      `      cid=$(grep -m1 "^callerid=" "$f" 2>/dev/null | cut -d= -f2- | tr "\\\\t\\\\r\\\\n" "   "); ` +
      `      audio=""; ` +
      `      for ext in wav WAV gsm; do ` +
      `        if [ -f "$dir/$msg.$ext" ]; then audio="$dir/$msg.$ext"; break; fi; ` +
      `      done; ` +
      `      printf "%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n" "$folder" "$msg" "$ot" "$dur" "$cid" "$audio" "$f"; ` +
      `    done; ` +
      `  done; ` +
      `else echo ""; fi'`;

    return await this.withSshConn(freepbxSettings, async (conn) => {
      const { stdout } = await this.execWithTimeout(conn, cmd, 60000);
      const lines = String(stdout || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      const parsed = [];
      for (const line of lines) {
        const [folder, msgId, origtimeStr, durationStr, callerid, audioPath, metadataPath] = line.split('\t');
        if (!folder || !msgId) continue;
        const origtime = Number.parseInt(origtimeStr || '0', 10) || 0;
        const durationSeconds = Number.parseInt(durationStr || '0', 10) || 0;
        parsed.push({
          mailbox: mb,
          vmContext: context,
          folder,
          msgId,
          receivedAt: origtime ? new Date(origtime * 1000).toISOString() : null,
          callerId: callerid || '',
          durationSeconds: durationSeconds || null,
          recordingPath: audioPath || null,
          metadataPath: metadataPath || null,
        });
      }

      parsed.sort((a, b) => {
        const at = a.receivedAt ? new Date(a.receivedAt).getTime() : 0;
        const bt = b.receivedAt ? new Date(b.receivedAt).getTime() : 0;
        return bt - at;
      });
      return parsed;
    });
  }

  static parseMsgTxtContents(contents) {
    const kv = parseKeyValueTxt(contents);
    const origtime = Number.parseInt(String(kv.origtime || '0'), 10) || 0;
    const duration = Number.parseInt(String(kv.duration || '0'), 10) || 0;
    return {
      origmailbox: kv.origmailbox || null,
      origtime: origtime || null,
      receivedAt: origtime ? new Date(origtime * 1000).toISOString() : null,
      callerid: kv.callerid || null,
      duration: duration || null,
      category: kv.category || null,
      raw: kv,
    };
  }

  static async deleteVoicemailOnPbx(freepbxSettings, { metadataPath, recordingPath, msgId }) {
    const meta = metadataPath ? String(metadataPath) : '';
    const rec = recordingPath ? String(recordingPath) : '';
    const mid = String(msgId || '').trim();

    const dirname = (p) => {
      const s = String(p || '');
      const idx = s.lastIndexOf('/');
      if (idx <= 0) return '';
      return s.slice(0, idx);
    };

    const dir = meta ? dirname(meta) : rec ? dirname(rec) : '';
    const base = dir && mid ? `${dir}/${mid}` : '';

    const candidates = [];
    if (meta) candidates.push(meta);
    if (base) {
      candidates.push(`${base}.txt`);
      candidates.push(`${base}.wav`);
      candidates.push(`${base}.WAV`);
      candidates.push(`${base}.gsm`);
      candidates.push(`${base}.GSM`);
      candidates.push(`${base}.mp3`);
      candidates.push(`${base}.MP3`);
    }
    if (rec) candidates.push(rec);

    const unique = Array.from(new Set(candidates.map((x) => String(x || '').trim()).filter(Boolean)));
    if (unique.length === 0) {
      throw new Error('No voicemail file paths available for deletion');
    }

    const quoted = unique.map(shellEscapeSingleQuotes).join(' ');
    const cmd = `bash -lc \"rm -f ${quoted} 2>/dev/null; echo ok\"`;

    return await this.withSshConn(freepbxSettings, async (conn) => {
      await this.execWithTimeout(conn, cmd, 60000);
      return { ok: true, deletedPaths: unique };
    });
  }

  /**
   * Move a voicemail message from INBOX to Old on the PBX (same as moveheard on the phone).
   * Idempotent: if source is already Old, no-op and return success.
   */
  static async moveVoicemailToOldOnPbx(freepbxSettings, { metadataPath, recordingPath, msgId }) {
    const meta = metadataPath ? String(metadataPath) : '';
    const rec = recordingPath ? String(recordingPath) : '';
    const mid = String(msgId || '').trim();

    const dirname = (p) => {
      const s = String(p || '');
      const idx = s.lastIndexOf('/');
      if (idx <= 0) return '';
      return s.slice(0, idx);
    };

    const sourceDir = meta ? dirname(meta) : rec ? dirname(rec) : '';
    if (!sourceDir || !mid) {
      throw new Error('No voicemail file paths available for move');
    }

    if (sourceDir.endsWith('/Old')) {
      logger.debug({ sourceDir }, '[voicemail] moveVoicemailToOldOnPbx: already Old, skip');
      return { ok: true, newMsgId: mid };
    }

    const targetDir = sourceDir.replace(/\/[^/]+$/, '/Old');
    const quotedSource = shellEscapeSingleQuotes(sourceDir);
    const quotedTarget = shellEscapeSingleQuotes(targetDir);
    const quotedMid = shellEscapeSingleQuotes(mid);
    // Use next free slot in Old so we never overwrite existing old messages (e.g. Old/msg0001, msg0002)
    const cmd =
      `bash -lc 'mkdir -p ${quotedTarget}; ` +
      `max=$(ls -1 ${quotedTarget}/msg*.txt 2>/dev/null | sed -n "s/.*\\\\/msg\\\\([0-9]*\\\\)\\\\.txt$/\\\\1/p" | sort -n | tail -1); ` +
      `[ -z "\$max" ] && max=-1; slot=$(printf "msg%04d" $((max+1))); ` +
      `for ext in txt wav WAV gsm GSM mp3 MP3; do f=${quotedSource}/${quotedMid}.\$ext; [ -f "\$f" ] && mv -- "\$f" ${quotedTarget}/\$slot.\$ext; done; ` +
      `echo NEWMSGID:\$slot'`;

    return await this.withSshConn(freepbxSettings, async (conn) => {
      const { stdout } = await this.execWithTimeout(conn, cmd, 60000);
      const match = String(stdout || '').match(/NEWMSGID:(msg\d+)/);
      const newMsgId = match ? match[1] : mid;
      logger.debug({ sourceDir, targetDir, oldMsgId: mid, newMsgId }, '[voicemail] moveVoicemailToOldOnPbx: move done');
      return { ok: true, newMsgId };
    });
  }
}

