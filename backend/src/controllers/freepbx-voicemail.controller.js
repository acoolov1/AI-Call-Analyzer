import { User } from '../models/User.js';
import { ForbiddenError } from '../utils/errors.js';
import { FreePbxVoicemailService } from '../services/freepbx-voicemail.service.js';
import { logger } from '../utils/logger.js';
import { VoicemailMessage } from '../models/VoicemailMessage.js';
import { FreePbxSshService } from '../services/freepbx-ssh.service.js';
import { runFreePbxVoicemailSyncNowForUserId } from '../jobs/freepbx-voicemail.job.js';

function requireSuperAdmin(req) {
  if (req.user?.role !== 'super_admin') {
    throw new ForbiddenError('Super admin access required');
  }
}

function getTargetUserId(req) {
  const requested = req.query.userId;
  if (!requested) return req.user.id;
  requireSuperAdmin(req);
  return String(requested);
}

export class FreePbxVoicemailController {
  static async mailboxes(req, res, next) {
    try {
      requireSuperAdmin(req);
      const userId = getTargetUserId(req);
      const settings = await User.getFreePbxSettingsRaw(userId);
      if (!settings?.voicemail_enabled) {
        return res.json({ success: true, data: { mailboxes: [] } });
      }
      const hasSshCreds = settings?.ssh_host && settings?.ssh_username && (settings?.ssh_password || settings?.ssh_private_key);
      if (!hasSshCreds) {
        return res.status(400).json({
          success: false,
          error: 'SSH host, username, and password or private key are required to read voicemail.',
        });
      }

      const mailboxes = await FreePbxVoicemailService.listMailboxes(settings);
      return res.json({ success: true, data: { mailboxes } });
    } catch (err) {
      next(err);
    }
  }

  // DB-first mailbox list (no SSH). Used for fast UI load.
  static async mailboxesDb(req, res, next) {
    try {
      requireSuperAdmin(req);
      const userId = getTargetUserId(req);
      const settings = await User.getFreePbxSettingsRaw(userId);
      if (!settings?.voicemail_enabled) {
        return res.json({ success: true, data: { mailboxes: [] } });
      }

      const vmContext = FreePbxVoicemailService.getVoicemailConfig(settings).context;
      const dbMailboxes = await VoicemailMessage.listMailboxesWithCounts({ userId, vmContext });
      return res.json({ success: true, data: { mailboxes: dbMailboxes } });
    } catch (err) {
      next(err);
    }
  }

  static async syncNow(req, res, next) {
    try {
      requireSuperAdmin(req);
      const userId = getTargetUserId(req);
      const settings = await User.getFreePbxSettingsRaw(userId);

      if (!settings?.voicemail_enabled) {
        return res.json({ success: true, message: 'Voicemail is disabled for this user.' });
      }

      const hasSshCreds = settings?.ssh_host && settings?.ssh_username && (settings?.ssh_password || settings?.ssh_private_key);
      if (!hasSshCreds) {
        return res.status(400).json({
          success: false,
          error: 'SSH host, username, and password or private key are required to sync voicemail.',
        });
      }

      // If already syncing, return immediately.
      if (settings?.voicemail_sync_in_progress) {
        return res.json({ success: true, message: 'Voicemail sync already in progress.' });
      }

      // Mark in-progress for immediate UI feedback.
      const startedAt = new Date();
      await User.mergeFreePbxSettings(userId, {
        voicemail_sync_in_progress: true,
        voicemail_sync_started_at: startedAt.toISOString(),
      }).catch(() => {});

      // Kick off background sync (returns immediately).
      runFreePbxVoicemailSyncNowForUserId(userId, { reason: 'manual' }).catch(() => {});
      return res.json({ success: true, message: 'Voicemail sync started.', data: { startedAt: startedAt.toISOString() } });
    } catch (err) {
      next(err);
    }
  }

  // DB-first message list (no SSH). Used for fast mailbox browsing.
  static async messagesDb(req, res, next) {
    try {
      requireSuperAdmin(req);
      const userId = getTargetUserId(req);
      const mailbox = String(req.query.mailbox || '').trim();
      if (!mailbox) {
        return res.status(400).json({ success: false, error: 'mailbox is required' });
      }

      const settings = await User.getFreePbxSettingsRaw(userId);
      if (!settings?.voicemail_enabled) {
        return res.json({ success: true, data: { messages: [] } });
      }

      const limit = Math.min(Number.parseInt(String(req.query.limit || '200'), 10) || 200, 500);
      const offset = Math.max(Number.parseInt(String(req.query.offset || '0'), 10) || 0, 0);

      const { context, folders } = FreePbxVoicemailService.getVoicemailConfig(settings);
      const rows = await VoicemailMessage.listByMailbox({ userId, mailbox, vmContext: context, folders, limit, offset });
      return res.json({ success: true, data: { messages: rows } });
    } catch (err) {
      next(err);
    }
  }

  static async audio(req, res, next) {
    try {
      requireSuperAdmin(req);
      const userId = getTargetUserId(req);
      const { id } = req.params;
      const vm = await VoicemailMessage.findById(id, userId);
      if (!vm?.recordingPath) {
        return res.status(404).json({ success: false, error: 'Voicemail recording not available' });
      }

      const settings = await User.getFreePbxSettingsRaw(userId);
      const sshConfig = FreePbxSshService.getSshConfig(settings);
      const remotePath = String(vm.recordingPath);

      const rangeHeader = req.headers.range;
      const parseRange = (rangeValue, totalSize) => {
        if (!rangeValue) return null;
        const m = String(rangeValue).match(/^bytes=(\d*)-(\d*)$/);
        if (!m) return { invalid: true };
        const startRaw = m[1];
        const endRaw = m[2];

        if (!startRaw && endRaw) {
          const suffixLen = Number.parseInt(endRaw, 10);
          if (!Number.isFinite(suffixLen) || suffixLen <= 0) return { invalid: true };
          const start = Math.max(totalSize - suffixLen, 0);
          const end = totalSize - 1;
          return { start, end };
        }

        const start = startRaw ? Number.parseInt(startRaw, 10) : 0;
        const end = endRaw ? Number.parseInt(endRaw, 10) : totalSize - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < 0) return { invalid: true };
        if (start >= totalSize || start > end) return { invalid: true };
        return { start, end: Math.min(end, totalSize - 1) };
      };

      const { default: SftpClient } = await import('ssh2-sftp-client');
      const sftp = new SftpClient(`vm-audio-${id}`);
      await sftp.connect({ ...sshConfig, privateKey: sshConfig.privateKey });

      try {
        const stat = await sftp.stat(remotePath);
        const totalSize = Number(stat?.size || 0);
        if (!totalSize) {
          return res.status(404).json({ success: false, error: 'Voicemail recording not found' });
        }

        const parsed = parseRange(rangeHeader, totalSize);
        if (parsed?.invalid) {
          res.setHeader('Content-Range', `bytes */${totalSize}`);
          return res.status(416).end();
        }

        const start = parsed?.start ?? 0;
        const end = parsed?.end ?? (totalSize - 1);
        const chunkSize = end - start + 1;
        const hasRange = Boolean(parsed);

        const filename = `${vm.mailbox}-${vm.msgId}.wav`;
        res.setHeader('Content-Type', 'audio/wav');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        res.setHeader('Accept-Ranges', 'bytes');

        if (hasRange) {
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
          res.setHeader('Content-Length', String(chunkSize));
        } else {
          res.status(200);
          res.setHeader('Content-Length', String(totalSize));
        }

        const stream = sftp.createReadStream(remotePath, { start, end });
        stream.on('error', async (e) => {
          try {
            await sftp.end();
          } catch {}
          next(e);
        });
        stream.on('close', async () => {
          try {
            await sftp.end();
          } catch {}
        });
        stream.pipe(res);
      } catch (err) {
        await sftp.end().catch(() => {});
        throw err;
      }
    } catch (err) {
      next(err);
    }
  }

  static async markAsListened(req, res, next) {
    try {
      const userId = getTargetUserId(req);
      const { id } = req.params;
      const vm = await VoicemailMessage.findById(id, userId);
      const settings = await User.getFreePbxSettingsRaw(userId);

      const isInbox = vm.folder === 'INBOX';
      const hasPaths = Boolean(vm.recordingPath || vm.metadataPath);

      logger.debug({ messageId: id, userId, folder: vm.folder, hasPaths }, '[voicemail] markAsListened');

      if (isInbox && hasPaths) {
        const hasSshCreds =
          settings?.ssh_host && settings?.ssh_username && (settings?.ssh_password || settings?.ssh_private_key);
        if (!hasSshCreds) {
          logger.warn({ userId }, '[voicemail] markAsListened: missing SSH creds');
          return res.status(400).json({
            success: false,
            error: 'SSH host, username, and password or private key are required to move voicemail to Old on PBX.',
          });
        }
        const { newMsgId } = await FreePbxVoicemailService.moveVoicemailToOldOnPbx(settings, {
          metadataPath: vm.metadataPath,
          recordingPath: vm.recordingPath,
          msgId: vm.msgId,
        });
        // Do not delete (Old, vm.msgId) — that's a different message (e.g. previous Old/msg0000). We use a new slot so no conflict.
        // Only clear the new slot if something already took it (e.g. sync), so we can take that key.
        await VoicemailMessage.deleteByUserMailboxFolderMsgIdExcept(
          userId,
          vm.vmContext,
          vm.mailbox,
          'Old',
          newMsgId,
          id
        );
        // Paths and msg_id now point to the new slot in Old (we don't overwrite existing Old/msg* files)
        const toOldPath = (p) => {
          if (!p) return p;
          const s = String(p).replace(/\/INBOX\/?/, '/Old/');
          return s.replace(new RegExp(`/${vm.msgId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.|$)`), `/${newMsgId}$1`);
        };
        const updates = {
          listenedAt: new Date(),
          folder: 'Old',
          msgId: newMsgId,
        };
        if (vm.recordingPath) updates.recordingPath = toOldPath(vm.recordingPath);
        if (vm.metadataPath) updates.metadataPath = toOldPath(vm.metadataPath);
        await VoicemailMessage.update(id, userId, updates);
        logger.debug({ messageId: id, newMsgId }, '[voicemail] markAsListened: moved to Old and updated DB');
      } else {
        await VoicemailMessage.update(id, userId, { listenedAt: new Date() });
        logger.debug({ messageId: id }, '[voicemail] markAsListened: set listened_at only');
      }
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err, messageId: req.params?.id }, '[voicemail] markAsListened failed');
      next(err);
    }
  }

  static async deleteMessage(req, res, next) {
    try {
      requireSuperAdmin(req);
      const userId = getTargetUserId(req);
      const { id } = req.params;

      const vm = await VoicemailMessage.findById(id, userId);
      const settings = await User.getFreePbxSettingsRaw(userId);
      if (!settings?.voicemail_enabled) {
        return res.status(400).json({ success: false, error: 'Voicemail is disabled for this user.' });
      }

      const hasSshCreds =
        settings?.ssh_host && settings?.ssh_username && (settings?.ssh_password || settings?.ssh_private_key);
      if (!hasSshCreds) {
        return res.status(400).json({
          success: false,
          error: 'SSH host, username, and password or private key are required to delete voicemail on PBX.',
        });
      }

      await FreePbxVoicemailService.deleteVoicemailOnPbx(settings, {
        metadataPath: vm.metadataPath,
        recordingPath: vm.recordingPath,
        msgId: vm.msgId,
      });

      await VoicemailMessage.deleteById(id, userId);
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }

  /** Clear stored voicemail last error so the UI stops showing it (e.g. after DB fix). */
  static async clearLastError(req, res, next) {
    try {
      requireSuperAdmin(req);
      const userId = getTargetUserId(req);
      await User.mergeFreePbxSettings(userId, { voicemail_last_result: null });
      return res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
}

