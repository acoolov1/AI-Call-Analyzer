import axios from 'axios';
import https from 'https';
import { config } from '../config/env.js';
import { FreePbxSshService } from './freepbx-ssh.service.js';
import { logger } from '../utils/logger.js';
import { CALL_SOURCE } from '../utils/constants.js';

const DEFAULT_TIMEOUT = 1000 * 15;

function normalizeSettings(overrides) {
  return {
    enabled: overrides?.enabled ?? config.freepbx.enabled,
    host: overrides?.host ?? config.freepbx.host,
    port: overrides?.port ?? config.freepbx.port ?? (config.freepbx.tls ? 8089 : 8088),
    username: overrides?.username ?? config.freepbx.username,
    password: overrides?.password ?? config.freepbx.password,
    tls: overrides?.tls ?? config.freepbx.tls,
    rejectUnauthorized: overrides?.rejectUnauthorized ?? config.freepbx.rejectUnauthorized,
  };
}

function buildBaseUrl(settings) {
  const protocol = settings.tls ? 'https' : 'http';
  const port = settings.port || (settings.tls ? 8089 : 8088);
  return `${protocol}://${settings.host}:${port}/ari`;
}

function createHttpClient(settings) {
  const cfg = normalizeSettings(settings);
  if (!FreePbxService.isEnabled(cfg)) {
    throw new Error('FreePBX integration is disabled');
  }

  const httpsAgent = cfg.tls
    ? new https.Agent({ rejectUnauthorized: cfg.rejectUnauthorized })
    : undefined;

  return axios.create({
    baseURL: buildBaseUrl(cfg),
    timeout: DEFAULT_TIMEOUT,
    auth: {
      username: cfg.username,
      password: cfg.password,
    },
    httpsAgent,
  });
}

export class FreePbxService {
  static isEnabled(settings) {
    const cfg = normalizeSettings(settings);
    return Boolean(
      cfg.enabled &&
      cfg.host &&
      cfg.username &&
      cfg.password
    );
  }

  static get callSource() {
    return CALL_SOURCE.FREEPBX;
  }

  static ensureEnabled(settings) {
    if (!this.isEnabled(settings)) {
      throw new Error('FreePBX integration is not configured');
    }
  }

  static async testConnection(settings) {
    this.ensureEnabled(settings);
    try {
      const client = createHttpClient(settings);
      const response = await client.get('/recordings/stored', { params: { limit: 1 } });
      return {
        ok: true,
        recordingsFound: response.data?.length || 0,
      };
    } catch (error) {
      logger.error({ error: error.message }, 'FreePBX connection test failed');
      throw new Error(`Failed to connect to FreePBX: ${error.message}`);
    }
  }

  static parseCallerFromFilename(filename) {
    // FreePBX filenames follow patterns like:
    // INBOUND:  external-200-+17173815064-20251122-221351-...  (external-[ext]-[caller])
    // OUTBOUND: out-+17173815064-200-20251122-221351-...       (out-[destination]-[ext])
    // INTERNAL: internal-201-200-20251122-221351-...           (internal-[from]-[to])
    
    // For inbound external calls: extract the number after the extension
    const externalMatch = filename.match(/external-\d+-([+\d]+)-/i);
    if (externalMatch && externalMatch[1]) {
      return externalMatch[1].replace(/[^\d]/g, '');
    }
    
    // For outbound calls: extract the destination number (first number after 'out-')
    const outboundMatch = filename.match(/out-([+\d]+)-\d+-/i);
    if (outboundMatch && outboundMatch[1]) {
      return outboundMatch[1].replace(/[^\d]/g, '');
    }
    
    // For internal calls: extract the calling extension
    const internalMatch = filename.match(/internal-(\d+)-\d+-/i);
    if (internalMatch && internalMatch[1]) {
      return internalMatch[1];
    }
    
    // Fallback to generic patterns
    const genericMatch = filename.match(/(?:in|exten)-([+\d]+)-/i);
    if (genericMatch && genericMatch[1]) {
      return genericMatch[1].replace(/[^\d]/g, '');
    }
    
    return null;
  }

  static normalizeRecording(raw) {
    if (!raw) return null;
    
    const callerNumber = this.parseCallerFromFilename(raw.name);
    
    return {
      raw,
      name: raw.name,
      format: raw.format,
      targetUri: raw['target_uri'],
      createdAt: raw['date_created'] ? new Date(raw['date_created']) : null,
      callerNumber,
    };
  }

  static filterBySince(recordings, since) {
    if (!since) return recordings;
    const sinceTime = new Date(since).getTime();
    return recordings.filter((recording) => {
      if (!recording.createdAt) return true;
      return recording.createdAt.getTime() > sinceTime;
    });
  }

  static async listRecordings({ since, settings } = {}) {
    this.ensureEnabled(settings);
    try {
      const client = createHttpClient(settings);
      const response = await client.get('/recordings/stored');
      const normalized = (response.data || [])
        .map((item) => this.normalizeRecording(item))
        .filter(Boolean)
        .sort((a, b) => {
          const aTime = a.createdAt ? a.createdAt.getTime() : 0;
          const bTime = b.createdAt ? b.createdAt.getTime() : 0;
          return aTime - bTime;
        });

      return this.filterBySince(normalized, since);
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to list FreePBX recordings');
      throw new Error(`Unable to list FreePBX recordings: ${error.message}`);
    }
  }

  static async downloadRecording(recordingName, settings) {
    if (!recordingName) {
      throw new Error('Recording name is required for FreePBX download');
    }

    // Download via SSH/SFTP only
    return await FreePbxSshService.downloadRecording(recordingName, settings);
  }
}

