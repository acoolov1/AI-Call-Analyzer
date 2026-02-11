import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import { VoicemailMessage, VOICEMAIL_STATUS } from '../models/VoicemailMessage.js';
import { OpenAIService } from './openai.service.js';
import { FreePbxSshService } from './freepbx-ssh.service.js';

export class VoicemailProcessingService {
  static async downloadVoicemailRecording(remotePath, freepbxSettings) {
    const { default: SftpClient } = await import('ssh2-sftp-client');
    const sshConfig = FreePbxSshService.getSshConfig(freepbxSettings);
    const sftp = new SftpClient(`vm-dl-${Date.now()}`);
    await sftp.connect({ ...sshConfig, privateKey: sshConfig.privateKey });
    try {
      const result = await sftp.get(String(remotePath));
      return Buffer.isBuffer(result) ? result : Buffer.from(result);
    } finally {
      await sftp.end().catch(() => {});
    }
  }

  static async processVoicemailMessage({ id, userId, freepbxSettings }) {
    const vm = await VoicemailMessage.findById(id, userId);
    if (!vm?.recordingPath) {
      await VoicemailMessage.update(id, userId, {
        status: VOICEMAIL_STATUS.FAILED,
        error: 'Recording path missing',
        processedAt: new Date().toISOString(),
      });
      return { ok: false, error: 'Recording path missing' };
    }

    const ext = path.extname(String(vm.recordingPath)).toLowerCase() || '.wav';
    const tempFilePath = path.join(process.cwd(), `temp-voicemail-${id}${ext}`);

    try {
      await VoicemailMessage.update(id, userId, { status: VOICEMAIL_STATUS.PROCESSING, error: null });

      const openaiSettings = await OpenAIService.getSettingsForUser(userId);
      const audioBuffer = await this.downloadVoicemailRecording(vm.recordingPath, freepbxSettings);

      const transcription = await OpenAIService.transcribeAudio(audioBuffer, tempFilePath, openaiSettings);
      const transcriptText = transcription?.text || '';

      await VoicemailMessage.update(id, userId, {
        transcript: transcriptText,
        analysis: '',
        status: VOICEMAIL_STATUS.COMPLETED,
        processedAt: new Date().toISOString(),
        error: null,
      });

      return { ok: true };
    } catch (error) {
      logger.error({ id, userId, error: error?.message }, 'Voicemail processing failed');
      await VoicemailMessage.update(id, userId, {
        status: VOICEMAIL_STATUS.FAILED,
        error: error?.message || String(error),
        processedAt: new Date().toISOString(),
      }).catch(() => {});
      return { ok: false, error: error?.message || String(error) };
    } finally {
      try {
        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
      } catch {}
    }
  }
}

