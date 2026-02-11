import express from 'express';
import { CallsController } from '../controllers/calls.controller.js';
import { StatsController } from '../controllers/stats.controller.js';
import { UserController } from '../controllers/user.controller.js';
import { FreePbxController } from '../controllers/freepbx.controller.js';
import { FreePbxCdrController } from '../controllers/freepbx-cdr.controller.js';
import { FreePbxVoicemailController } from '../controllers/freepbx-voicemail.controller.js';
import { FreepbxExtensionsController } from '../controllers/freepbx-extensions.controller.js';
import { FreepbxRecordingOverridesController } from '../controllers/freepbx-recording-overrides.controller.js';
import { OpenAIController } from '../controllers/openai.controller.js';
import { OpenAIUsageController } from '../controllers/openai-usage.controller.js';
import { BillingController } from '../controllers/billing.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireAppAccess } from '../middleware/app-access.middleware.js';
import { apiRateLimiter } from '../middleware/rate-limit.middleware.js';
import { getPool } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';
import { parseWavDurationSeconds } from '../utils/wav-duration.js';

const router = express.Router();

// Skip authentication for webhook routes (they use Twilio signature verification)
router.use((req, res, next) => {
  // If this is a webhook route, skip authentication
  if (req.path.startsWith('/webhooks/')) {
    return next();
  }
  // Otherwise, require authentication
  authenticate(req, res, next);
});

router.use(apiRateLimiter);

// Core app functionality access gate (calls, dashboards, integrations, audio)
router.use(['/calls', '/stats', '/integrations', '/cdr-calls', '/audio', '/billing'], requireAppAccess);

// Calls routes
router.get('/calls', CallsController.listCalls);
router.get('/calls/:id', CallsController.getCall);
router.delete('/calls/:id', CallsController.deleteCall);
router.delete('/calls/bulk/delete', CallsController.bulkDeleteCalls);
router.post('/calls/:id/retry', CallsController.retryCall);

// Stats route
router.get('/stats', StatsController.getStats);

// User routes
router.get('/user', UserController.getCurrentUser);
router.get('/user/freepbx/mysql-password', UserController.getFreepbxMysqlPassword);
router.patch('/user/preferences', UserController.updatePreferences);
router.patch('/user/profile', UserController.updateProfile);

// FreePBX routes
router.get('/integrations/freepbx/status', FreePbxController.status);
router.post('/integrations/freepbx/test', FreePbxController.testConnection);
router.post('/integrations/freepbx/test-ssh', FreePbxController.testSshConnection);
router.get('/integrations/freepbx/recordings-stats', FreePbxController.recordingsStats);
router.post('/integrations/freepbx/sync', FreePbxController.syncNow);
router.get('/integrations/freepbx/extensions', FreepbxExtensionsController.getDirectory);
router.post('/integrations/freepbx/extensions/refresh', FreepbxExtensionsController.refreshDirectory);
router.post(
  '/integrations/freepbx/extensions/recording-overrides/apply',
  FreepbxRecordingOverridesController.apply
);

// FreePBX Voicemail routes (superadmin-only for now)
router.get('/integrations/freepbx/voicemail/mailboxes', FreePbxVoicemailController.mailboxes);
router.get('/integrations/freepbx/voicemail/mailboxes-db', FreePbxVoicemailController.mailboxesDb);
router.post('/integrations/freepbx/voicemail/sync', FreePbxVoicemailController.syncNow);
router.get('/integrations/freepbx/voicemail/messages-db', FreePbxVoicemailController.messagesDb);
router.get('/integrations/freepbx/voicemail/audio/:id', FreePbxVoicemailController.audio);
router.patch('/integrations/freepbx/voicemail/messages/:id', FreePbxVoicemailController.markAsListened);
router.delete('/integrations/freepbx/voicemail/messages/:id', FreePbxVoicemailController.deleteMessage);
router.post('/integrations/freepbx/voicemail/clear-last-error', FreePbxVoicemailController.clearLastError);

// FreePBX CDR routes
router.get('/integrations/freepbx/cdr/status', FreePbxCdrController.getStatus);
router.post('/integrations/freepbx/cdr/test', FreePbxCdrController.testConnection);
router.post('/integrations/freepbx/cdr/sync', FreePbxCdrController.syncNow);
router.get('/cdr-calls', FreePbxCdrController.getCdrCalls);
router.get('/cdr-calls/ids', FreePbxCdrController.getCdrCallIds);

// OpenAI routes
router.post('/integrations/openai/test', OpenAIController.testConnection);
router.get('/integrations/openai/usage-summary', OpenAIUsageController.usageSummary);
router.get('/integrations/openai/usage-history', OpenAIUsageController.usageHistory);

// Billing routes (user-scoped)
router.get('/billing/audio-daily', BillingController.audioDaily);
router.get('/billing/monthly-history', BillingController.monthlyHistory);

// Audio route (for serving recordings)
router.get('/audio/:id/meta', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { Call } = await import('../models/Call.js');
    const { CALL_SOURCE } = await import('../utils/constants.js');
    const fs = await import('fs');
    const path = await import('path');

    // First, try to find the call for the current user
    let call = await Call.findById(id, req.user.id).catch(() => null);

    // If not found and user is super admin, try to find the call regardless of owner
    if (!call && req.user.role === 'super_admin') {
      const pool = getPool();
      const result = await pool.query('SELECT * FROM calls WHERE id = $1', [id]);
      if (result.rows.length > 0) {
        call = Call.mapRowToCall(result.rows[0]);
      }
    }

    if (!call) {
      throw new NotFoundError('Call not found');
    }

    // If we already have a stored duration, return it immediately (lightest path).
    const storedDuration = Number(call.duration || 0);
    if (Number.isFinite(storedDuration) && storedDuration > 0) {
      return res.json({ durationSeconds: storedDuration });
    }

    const readHeaderBytes = async ({ readStreamFactory, maxBytes }) =>
      new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        const stream = readStreamFactory();

        const cleanup = () => {
          try {
            stream.destroy();
          } catch {}
        };

        stream.on('data', (chunk) => {
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          chunks.push(b);
          total += b.length;
          if (total >= maxBytes) {
            cleanup();
            resolve(Buffer.concat(chunks, Math.min(total, maxBytes)));
          }
        });
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', (err) => {
          cleanup();
          reject(err);
        });
      });

    // Local redacted file path (Twilio redaction)
    if (call.recordingPath) {
      const redactedDir = path.join(process.cwd(), 'redacted-audio');
      const resolved = path.resolve(call.recordingPath);
      const resolvedDir = path.resolve(redactedDir);
      if (resolved.startsWith(resolvedDir) && fs.existsSync(resolved)) {
        const header = await readHeaderBytes({
          maxBytes: 16 * 1024,
          readStreamFactory: () => fs.createReadStream(resolved, { start: 0, end: 16 * 1024 - 1 }),
        });
        const durationSeconds = parseWavDurationSeconds(header);
        return res.json({ durationSeconds });
      }
    }

    // FreePBX WAV: range-read first bytes over SFTP.
    if (call.source === CALL_SOURCE.FREEPBX || call.source === CALL_SOURCE.FREEPBX_CDR) {
      const { User } = await import('../models/User.js');
      const { FreePbxSshService } = await import('../services/freepbx-ssh.service.js');
      const { default: SftpClient } = await import('ssh2-sftp-client');

      const freepbxSettings = await User.getFreePbxSettingsRaw(call.userId);
      const recordingRef = call.recordingPath || call.recordingUrl;
      const remotePath = FreePbxSshService.resolveRemotePath(recordingRef, freepbxSettings);
      const sshConfig = FreePbxSshService.getSshConfig(freepbxSettings);

      const sftp = new SftpClient(`audio-meta-${id}`);
      await sftp.connect({
        ...sshConfig,
        privateKey: sshConfig.privateKey,
      });

      try {
        const header = await readHeaderBytes({
          maxBytes: 16 * 1024,
          readStreamFactory: () => sftp.createReadStream(remotePath, { start: 0, end: 16 * 1024 - 1 }),
        });
        const durationSeconds = parseWavDurationSeconds(header);
        await sftp.end().catch(() => {});
        return res.json({ durationSeconds });
      } catch (err) {
        await sftp.end().catch(() => {});
        throw err;
      }
    }

    return res.json({ durationSeconds: null });
  } catch (error) {
    next(error);
  }
});

router.get('/audio/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { Call } = await import('../models/Call.js');
    const { TwilioService } = await import('../services/twilio.service.js');
    const { CALL_SOURCE } = await import('../utils/constants.js');
    const fs = await import('fs');
    const path = await import('path');

    const rangeHeader = req.headers.range;

    const parseRange = (rangeValue, totalSize) => {
      if (!rangeValue) return null;
      const m = String(rangeValue).match(/^bytes=(\d*)-(\d*)$/);
      if (!m) return { invalid: true };
      const startRaw = m[1];
      const endRaw = m[2];

      // Suffix range: bytes=-500
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

    const sendStream = ({ totalSize, filename, streamFactory }) => {
      const parsed = parseRange(rangeHeader, totalSize);
      if (parsed?.invalid) {
        res.setHeader('Content-Range', `bytes */${totalSize}`);
        return res.status(416).end();
      }

      const hasRange = Boolean(parsed);
      const start = parsed?.start ?? 0;
      const end = parsed?.end ?? (totalSize - 1);
      const chunkSize = end - start + 1;

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

      const stream = streamFactory({ start, end, hasRange });

      // Ensure we clean up on client abort.
      res.on('close', () => {
        try {
          stream.destroy();
        } catch {}
      });

      stream.on('error', (err) => {
        try {
          stream.destroy();
        } catch {}
        if (!res.headersSent) {
          return next(err);
        }
      });

      stream.pipe(res);
    };

    // First, try to find the call for the current user
    let call = await Call.findById(id, req.user.id).catch(() => null);

    // If not found and user is super admin, try to find the call regardless of owner
    if (!call && req.user.role === 'super_admin') {
      const pool = getPool();
      const result = await pool.query('SELECT * FROM calls WHERE id = $1', [id]);
      if (result.rows.length > 0) {
        call = Call.mapRowToCall(result.rows[0]);
      }
    }

    if (!call) {
      throw new NotFoundError('Call not found');
    }

    if (!call.recordingUrl && !call.recordingPath) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // If we have a local redacted audio file path (used for Twilio redaction), serve it first.
    // Safety: only serve files from the backend's redacted-audio directory.
    if (call.recordingPath) {
      const redactedDir = path.join(process.cwd(), 'redacted-audio');
      const resolved = path.resolve(call.recordingPath);
      const resolvedDir = path.resolve(redactedDir);
      if (resolved.startsWith(resolvedDir) && fs.existsSync(resolved)) {
        const stat = await fs.promises.stat(resolved);
        return sendStream({
          totalSize: stat.size,
          filename: `recording-${id}-redacted.wav`,
          streamFactory: ({ start, end, hasRange }) =>
            fs.createReadStream(resolved, hasRange ? { start, end } : undefined),
        });
      }
    }

    // FreePBX recordings: stream over SFTP with HTTP Range support.
    if (call.source === CALL_SOURCE.FREEPBX || call.source === CALL_SOURCE.FREEPBX_CDR) {
      const { User } = await import('../models/User.js');
      const { FreePbxSshService } = await import('../services/freepbx-ssh.service.js');
      const { default: SftpClient } = await import('ssh2-sftp-client');

      // Use the call owner's settings, not the admin's
      const freepbxSettings = await User.getFreePbxSettingsRaw(call.userId);
      const recordingRef = call.recordingPath || call.recordingUrl;
      const remotePath = FreePbxSshService.resolveRemotePath(recordingRef, freepbxSettings);
      const sshConfig = FreePbxSshService.getSshConfig(freepbxSettings);

      const sftp = new SftpClient(`audio-${id}`);
      await sftp.connect({
        ...sshConfig,
        privateKey: sshConfig.privateKey,
      });

      try {
        const stat = await sftp.stat(remotePath);
        const totalSize = Number(stat?.size || 0);
        if (!totalSize) {
          await sftp.end().catch(() => {});
          return res.status(404).json({ error: 'Recording not found' });
        }

        return sendStream({
          totalSize,
          filename: `recording-${id}.wav`,
          streamFactory: ({ start, end, hasRange }) => {
            const stream = sftp.createReadStream(remotePath, hasRange ? { start, end } : undefined);
            const cleanup = async () => {
              try {
                await sftp.end();
              } catch {}
            };
            stream.on('close', cleanup);
            stream.on('end', cleanup);
            stream.on('error', cleanup);
            return stream;
          },
        });
      } catch (err) {
        await sftp.end().catch(() => {});
        throw err;
      }
    }

    // Fallback: Twilio (buffered)
    const audioBuffer = await TwilioService.downloadRecording(call.recordingUrl);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="recording-${id}.wav"`);
    return res.send(audioBuffer);
  } catch (error) {
    console.error('❌ Audio download error:', error.message);
    console.error('Stack:', error.stack);
    next(error);
  }
});

export default router;

