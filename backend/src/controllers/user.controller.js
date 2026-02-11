import { User } from '../models/User.js';
import { FreepbxExtensionDirectory } from '../models/FreepbxExtensionDirectory.js';
import { logger } from '../utils/logger.js';
import { BadRequestError, ForbiddenError } from '../utils/errors.js';
import { decryptSecret } from '../utils/crypto.js';
import { computeNextRunAtUtcISO, isValidDailyHHMM, normalizeDailyHHMM } from '../utils/retention-schedule.js';

export class UserController {
  /**
   * Helper to get target user ID
   * If admin and userId query param provided, use that
   * Otherwise use authenticated user's ID
   */
  static getTargetUserId(req) {
    const requestedUserId = req.query.userId;
    
    // If no userId param, use current user
    if (!requestedUserId) {
      return req.user.id;
    }
    
    // If userId param provided, check if user is super admin
    if (req.user.role !== 'super_admin') {
      throw new ForbiddenError('Only admins can access other users\' settings');
    }
    
    logger.info({ 
      adminId: req.user.id, 
      targetUserId: requestedUserId 
    }, 'Admin accessing another user\'s settings');
    
    return requestedUserId;
  }

  /**
   * GET /api/v1/user
   * Get current authenticated user information
   * Supports ?userId=xxx query param for admins
   */
  static async getCurrentUser(req, res, next) {
    try {
      const userId = UserController.getTargetUserId(req);

      console.log(`\n👤 Fetching user info for user: ${userId}`);

      const user = await User.findById(userId);

      // Backfill call-history direction flags for older records where keys don't exist yet.
      try {
        const rawFree = await User.getFreePbxSettingsRaw(userId);
        const hasInboundFlag = typeof rawFree?.call_history_include_inbound === 'boolean';
        const hasOutboundFlag = typeof rawFree?.call_history_include_outbound === 'boolean';
        if (!hasInboundFlag || !hasOutboundFlag) {
          const directory = await FreepbxExtensionDirectory.getByUserId(userId);
          const extNumbers = (Array.isArray(directory?.extensions) ? directory.extensions : [])
            .map((e) => String(e?.number || '').trim())
            .filter(Boolean);

          const normalize = (value) =>
            Array.isArray(value) ? value.map((v) => String(v || '').trim()).filter(Boolean) : [];

          const excludedInbound = new Set(normalize(rawFree?.call_history_excluded_inbound_extensions));
          const excludedOutbound = new Set(normalize(rawFree?.call_history_excluded_outbound_extensions));

          const inboundExcludedAll =
            extNumbers.length > 0 && extNumbers.every((n) => excludedInbound.has(n));
          const outboundExcludedAll =
            extNumbers.length > 0 && extNumbers.every((n) => excludedOutbound.has(n));

          const includeInbound = hasInboundFlag ? rawFree.call_history_include_inbound : !inboundExcludedAll;
          const includeOutbound = hasOutboundFlag ? rawFree.call_history_include_outbound : !outboundExcludedAll;

          await User.mergeFreePbxSettings(userId, {
            call_history_include_inbound: includeInbound,
            call_history_include_outbound: includeOutbound,
          });

          if (user?.freepbxSettings) {
            user.freepbxSettings.call_history_include_inbound = includeInbound;
            user.freepbxSettings.call_history_include_outbound = includeOutbound;
          }
        }
      } catch (e) {
        // Non-fatal: do not block /user response
      }

      console.log(`✅ Found user: ${user.email}`);

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      console.error('❌ Error fetching user:', error.message);
      logger.error({ error: error.message, userId: req.user?.id }, 'Error fetching user');
      next(error);
    }
  }

  /**
   * GET /api/v1/user/freepbx/mysql-password
   * Super-admin-only: reveal the saved MySQL password for FreePBX integration.
   * Supports ?userId=xxx to view another user's saved password.
   */
  static async getFreepbxMysqlPassword(req, res, next) {
    try {
      if (req.user?.role !== 'super_admin') {
        throw new ForbiddenError('Only super admins can reveal saved MySQL passwords');
      }

      const userId = UserController.getTargetUserId(req);
      const rawFreePbxSettings = await User.getFreePbxSettingsRaw(userId);
      const stored = rawFreePbxSettings?.mysql_password || null;

      // Some deployments store secrets encrypted; others store plaintext in JSONB.
      // Attempt decrypt if payload looks like our iv:tag:data format; otherwise return as-is.
      let mysqlPassword = stored;
      if (typeof stored === 'string') {
        const parts = stored.split(':');
        if (parts.length === 3 && parts.every((p) => p && /^[A-Za-z0-9+/=_-]+$/.test(p))) {
          try {
            const decrypted = decryptSecret(stored);
            mysqlPassword = typeof decrypted === 'string' ? decrypted : stored;
          } catch (e) {
            mysqlPassword = stored;
          }
        }
      }

      res.json({
        success: true,
        data: {
          mysql_password: mysqlPassword,
        },
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'Error revealing FreePBX MySQL password');
      next(error);
    }
  }

  /**
   * PATCH /api/v1/user/preferences
   * Update user preferences (timezone, twilioSettings, etc.)
   * Supports ?userId=xxx query param for admins
   */
  static async updatePreferences(req, res, next) {
    try {
      const userId = UserController.getTargetUserId(req);
      const { timezone, twilioSettings, freepbxSettings, openaiSettings, billingSettings } = req.body;

      console.log(`\n⚙️ Updating preferences for user: ${userId}`);

      // Validate timezone if provided
      if (timezone) {
        // List of valid IANA timezones can be validated with Intl API
        try {
          Intl.DateTimeFormat(undefined, { timeZone: timezone });
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: 'Invalid timezone format. Please use IANA timezone format (e.g., America/New_York)',
          });
        }
      }

      // Validate Twilio settings if provided
      if (twilioSettings) {
        const validKeys = [
          'forwardingEnabled',
          'forwardPhoneNumber',
          'recordingEnabled',
          'callTimeout',
          'customGreeting',
          'playRecordingBeep',
          'maxRecordingLength',
          'finishOnKey',
          'afterHoursMessage',
          'recordingMode',
        ];

        // Check for invalid keys
        const invalidKeys = Object.keys(twilioSettings).filter(key => !validKeys.includes(key));
        if (invalidKeys.length > 0) {
          return res.status(400).json({
            success: false,
            message: `Invalid Twilio settings keys: ${invalidKeys.join(', ')}`,
          });
        }

        // Validate specific fields
        if (twilioSettings.callTimeout !== undefined && 
            (twilioSettings.callTimeout < 5 || twilioSettings.callTimeout > 600)) {
          return res.status(400).json({
            success: false,
            message: 'callTimeout must be between 5 and 600 seconds',
          });
        }

        if (twilioSettings.maxRecordingLength !== undefined && 
            (twilioSettings.maxRecordingLength < 60 || twilioSettings.maxRecordingLength > 14400)) {
          return res.status(400).json({
            success: false,
            message: 'maxRecordingLength must be between 60 and 14400 seconds (4 hours)',
          });
        }

        if (twilioSettings.recordingMode !== undefined && 
            !['record-from-answer', 'record-from-ringing', 'do-not-record'].includes(twilioSettings.recordingMode)) {
          return res.status(400).json({
            success: false,
            message: 'recordingMode must be one of: record-from-answer, record-from-ringing, do-not-record',
          });
        }
      }

      const updates = {};
      if (timezone !== undefined) {
        updates.timezone = timezone;
      }

      let currentUser = null;
      let rawFreePbxSettings = null;
      let rawOpenAISettings = null;
      let rawBillingSettings = null;
      if (
        twilioSettings !== undefined ||
        freepbxSettings !== undefined ||
        openaiSettings !== undefined ||
        billingSettings !== undefined
      ) {
        currentUser = await User.findById(userId);
      }
      if (freepbxSettings !== undefined) {
        rawFreePbxSettings = await User.getFreePbxSettingsRaw(userId);
      }
      if (openaiSettings !== undefined) {
        rawOpenAISettings = await User.getOpenAISettingsRaw(userId);
      }
      if (billingSettings !== undefined) {
        rawBillingSettings = await User.getBillingSettingsRaw(userId);
      }

      if (twilioSettings !== undefined) {
        const baseSettings = currentUser?.twilioSettings || {
          forwardingEnabled: true,
          forwardPhoneNumber: '',
          recordingEnabled: true,
          callTimeout: 30,
          customGreeting: '',
          playRecordingBeep: true,
          maxRecordingLength: 3600,
          finishOnKey: '#',
          afterHoursMessage: '',
          recordingMode: 'record-from-answer',
        };
        
        updates.twilioSettings = {
          ...baseSettings,
          ...twilioSettings,
        };
      }

      if (freepbxSettings !== undefined) {
        const sanitizeRecordingOverrides = (value) => {
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
            if (Object.keys(entry).length > 0) {
              out[ext] = entry;
            }
          }
          return out;
        };

        const baseFreePbx = {
          enabled: false,
          integration_date: rawFreePbxSettings?.integration_date,
          host: '',
          port: 8089,
          username: '',
          tls: true,
          password: rawFreePbxSettings?.password,
          mysql_host: rawFreePbxSettings?.mysql_host || '',
          mysql_port: rawFreePbxSettings?.mysql_port || 3306,
          mysql_username: rawFreePbxSettings?.mysql_username || '',
          mysql_password: rawFreePbxSettings?.mysql_password,
          mysql_database: rawFreePbxSettings?.mysql_database || 'asteriskcdrdb',
          serverTimezone: rawFreePbxSettings?.serverTimezone || '',
          syncIntervalMinutes: 10,
          ssh_host: rawFreePbxSettings?.ssh_host || rawFreePbxSettings?.host || '',
          ssh_port: rawFreePbxSettings?.ssh_port || 22,
          ssh_username: rawFreePbxSettings?.ssh_username || '',
          ssh_password: rawFreePbxSettings?.ssh_password,
          ssh_private_key: rawFreePbxSettings?.ssh_private_key,
          ssh_passphrase: rawFreePbxSettings?.ssh_passphrase,
          ssh_base_path: rawFreePbxSettings?.ssh_base_path || '/var/spool/asterisk/monitor',
          // Recording retention (once/day, SSH-based deletion)
          retention_enabled: rawFreePbxSettings?.retention_enabled ?? false,
          retention_days: rawFreePbxSettings?.retention_days ?? 30,
          retention_run_time: rawFreePbxSettings?.retention_run_time ?? '02:00',
          retention_next_run_at: rawFreePbxSettings?.retention_next_run_at ?? null,
          retention_last_run_at: rawFreePbxSettings?.retention_last_run_at ?? null,
          retention_last_result: rawFreePbxSettings?.retention_last_result ?? null,
        };

        const mergedSettings = {
          ...baseFreePbx,
          ...rawFreePbxSettings,
          ...freepbxSettings,
        };

        if (mergedSettings.port < 1 || mergedSettings.port > 65535) {
          return res.status(400).json({
            success: false,
            message: 'port must be between 1 and 65535',
          });
        }

        if (mergedSettings.syncIntervalMinutes < 1) {
          return res.status(400).json({
            success: false,
            message: 'syncIntervalMinutes must be at least 1 minute',
          });
        }

        if (mergedSettings.ssh_port && (mergedSettings.ssh_port < 1 || mergedSettings.ssh_port > 65535)) {
          return res.status(400).json({
            success: false,
            message: 'ssh_port must be between 1 and 65535',
          });
        }

        // Retention validation (days-only, scheduled once/day)
        const retentionEnabled = Boolean(mergedSettings.retention_enabled);
        const retentionDaysRaw = mergedSettings.retention_days ?? mergedSettings.retentionDays;
        const retentionDays = retentionDaysRaw === undefined || retentionDaysRaw === null
          ? (rawFreePbxSettings?.retention_days ?? 30)
          : Number.parseInt(String(retentionDaysRaw), 10);
        if (retentionEnabled) {
          if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
            return res.status(400).json({
              success: false,
              message: 'retention_days must be a number between 1 and 3650',
            });
          }

          const runTimeRaw = mergedSettings.retention_run_time ?? mergedSettings.retentionRunTime ?? '02:00';
          if (!isValidDailyHHMM(String(runTimeRaw))) {
            return res.status(400).json({
              success: false,
              message: 'retention_run_time must be in HH:MM (24h) format',
            });
          }
        }

        // Voicemail settings validation
        const voicemailEnabled = Boolean(mergedSettings.voicemail_enabled);
        const voicemailBasePathRaw =
          mergedSettings.voicemail_base_path ?? mergedSettings.voicemailBasePath ?? rawFreePbxSettings?.voicemail_base_path ?? '/var/spool/asterisk/voicemail';
        const voicemailBasePath = String(voicemailBasePathRaw || '/var/spool/asterisk/voicemail').trim();
        const voicemailContextRaw =
          mergedSettings.voicemail_context ?? mergedSettings.voicemailContext ?? rawFreePbxSettings?.voicemail_context ?? 'default';
        const voicemailContext = String(voicemailContextRaw || 'default').trim() || 'default';
        const voicemailFoldersRaw =
          mergedSettings.voicemail_folders ?? mergedSettings.voicemailFolders ?? rawFreePbxSettings?.voicemail_folders ?? ['INBOX', 'Old'];
        const voicemailFolders = Array.isArray(voicemailFoldersRaw)
          ? voicemailFoldersRaw.map((x) => String(x || '').trim()).filter(Boolean)
          : ['INBOX', 'Old'];
        const voicemailSyncIntervalRaw =
          mergedSettings.voicemail_sync_interval_minutes ?? mergedSettings.voicemailSyncIntervalMinutes ?? rawFreePbxSettings?.voicemail_sync_interval_minutes ?? 5;
        const voicemailSyncIntervalMinutes = Number.parseInt(String(voicemailSyncIntervalRaw), 10);

        if (voicemailEnabled) {
          if (!voicemailBasePath.startsWith('/')) {
            return res.status(400).json({
              success: false,
              message: 'voicemail_base_path must be an absolute path',
            });
          }
          if (!/^[A-Za-z0-9_-]+$/.test(voicemailContext)) {
            return res.status(400).json({
              success: false,
              message: 'voicemail_context must be alphanumeric (plus _ or -)',
            });
          }
          if (!Array.isArray(voicemailFolders) || voicemailFolders.length === 0) {
            return res.status(400).json({
              success: false,
              message: 'voicemail_folders must be a non-empty array',
            });
          }
          if (!Number.isFinite(voicemailSyncIntervalMinutes) || voicemailSyncIntervalMinutes < 1 || voicemailSyncIntervalMinutes > 1440) {
            return res.status(400).json({
              success: false,
              message: 'voicemail_sync_interval_minutes must be between 1 and 1440',
            });
          }
        }

        let resolvedPassword = baseFreePbx.password;
        if (typeof freepbxSettings.password === 'string') {
          resolvedPassword = freepbxSettings.password.length > 0 ? freepbxSettings.password : null;
        }

        let resolvedMysqlPassword = baseFreePbx.mysql_password;
        if (typeof freepbxSettings.mysql_password === 'string') {
          resolvedMysqlPassword = freepbxSettings.mysql_password.length > 0 ? freepbxSettings.mysql_password : null;
        }

        let resolvedSshPassword = baseFreePbx.ssh_password;
        if (typeof freepbxSettings.ssh_password === 'string') {
          resolvedSshPassword = freepbxSettings.ssh_password.length > 0 ? freepbxSettings.ssh_password : null;
        }

        let resolvedSshPrivateKey = baseFreePbx.ssh_private_key;
        if (typeof freepbxSettings.ssh_private_key === 'string') {
          resolvedSshPrivateKey = freepbxSettings.ssh_private_key.length > 0 ? freepbxSettings.ssh_private_key : null;
        }

        let resolvedSshPassphrase = baseFreePbx.ssh_passphrase;
        if (typeof freepbxSettings.ssh_passphrase === 'string') {
          resolvedSshPassphrase = freepbxSettings.ssh_passphrase.length > 0 ? freepbxSettings.ssh_passphrase : null;
        }

        if (mergedSettings.enabled) {
          // When enabled, require either MySQL OR SSH to be configured
          const hasMysqlConfig = mergedSettings.mysql_host && mergedSettings.mysql_username && resolvedMysqlPassword;
          const hasSshConfig = mergedSettings.ssh_host && mergedSettings.ssh_username && (resolvedSshPassword || resolvedSshPrivateKey);
          
          if (!hasMysqlConfig && !hasSshConfig) {
            return res.status(400).json({
              success: false,
              message: 'MySQL or SSH credentials are required when FreePBX is enabled',
            });
          }
        }

        // Set integration_date when FreePBX is first enabled
        let integrationDate = rawFreePbxSettings?.integration_date;
        if (mergedSettings.enabled && !rawFreePbxSettings?.enabled && !integrationDate) {
          // FreePBX is being enabled for the first time
          integrationDate = new Date().toISOString();
          logger.info({ userId, integrationDate }, 'Setting FreePBX integration date for new integration');
        }

        // Compute next retention run time (UTC ISO) when enabled and schedule fields change.
        const userForTz = currentUser || await User.findById(userId);
        const userTimezone = userForTz?.timezone || 'UTC';
        const retentionRunTime = normalizeDailyHHMM(
          mergedSettings.retention_run_time ?? mergedSettings.retentionRunTime ?? rawFreePbxSettings?.retention_run_time ?? '02:00',
          '02:00'
        );
        const shouldComputeNextRun =
          retentionEnabled &&
          (
            freepbxSettings.retention_enabled !== undefined ||
            freepbxSettings.retention_days !== undefined ||
            freepbxSettings.retention_run_time !== undefined ||
            freepbxSettings.retentionRunTime !== undefined ||
            !rawFreePbxSettings?.retention_next_run_at
          );
        const nextRunAt = shouldComputeNextRun
          ? computeNextRunAtUtcISO({ timezone: userTimezone, hhmm: retentionRunTime, now: new Date() })
          : (rawFreePbxSettings?.retention_next_run_at ?? null);

        updates.freepbxSettings = {
          enabled: Boolean(mergedSettings.enabled),
          integration_date: integrationDate || null,
          host: mergedSettings.host || null,
          port: Number(mergedSettings.port) || null,
          username: mergedSettings.username || null,
          tls: mergedSettings.tls !== false,
          password: resolvedPassword || null,
          // Global call-history direction enablement (used by Calls subtitle + server-side filtering)
          call_history_include_inbound:
            typeof mergedSettings.call_history_include_inbound === 'boolean'
              ? mergedSettings.call_history_include_inbound
              : (typeof rawFreePbxSettings?.call_history_include_inbound === 'boolean'
                ? rawFreePbxSettings.call_history_include_inbound
                : true),
          call_history_include_outbound:
            typeof mergedSettings.call_history_include_outbound === 'boolean'
              ? mergedSettings.call_history_include_outbound
              : (typeof rawFreePbxSettings?.call_history_include_outbound === 'boolean'
                ? rawFreePbxSettings.call_history_include_outbound
                : true),
          call_history_include_internal:
            typeof mergedSettings.call_history_include_internal === 'boolean'
              ? mergedSettings.call_history_include_internal
              : (typeof rawFreePbxSettings?.call_history_include_internal === 'boolean'
                ? rawFreePbxSettings.call_history_include_internal
                : true),
          call_history_excluded_inbound_extensions: Array.isArray(mergedSettings.call_history_excluded_inbound_extensions)
            ? mergedSettings.call_history_excluded_inbound_extensions
            : (Array.isArray(rawFreePbxSettings?.call_history_excluded_inbound_extensions)
              ? rawFreePbxSettings.call_history_excluded_inbound_extensions
              : []),
          call_history_excluded_outbound_extensions: Array.isArray(mergedSettings.call_history_excluded_outbound_extensions)
            ? mergedSettings.call_history_excluded_outbound_extensions
            : (Array.isArray(rawFreePbxSettings?.call_history_excluded_outbound_extensions)
              ? rawFreePbxSettings.call_history_excluded_outbound_extensions
              : []),
          call_history_excluded_internal_extensions: Array.isArray(mergedSettings.call_history_excluded_internal_extensions)
            ? mergedSettings.call_history_excluded_internal_extensions
            : (Array.isArray(rawFreePbxSettings?.call_history_excluded_internal_extensions)
              ? rawFreePbxSettings.call_history_excluded_internal_extensions
              : []),
          call_recording_overrides: sanitizeRecordingOverrides(
            mergedSettings.call_recording_overrides !== undefined
              ? mergedSettings.call_recording_overrides
              : rawFreePbxSettings?.call_recording_overrides
          ),
          mysql_host: mergedSettings.mysql_host || null,
          mysql_port: Number(mergedSettings.mysql_port) || 3306,
          mysql_username: mergedSettings.mysql_username || null,
          mysql_password: resolvedMysqlPassword || null,
          mysql_database: mergedSettings.mysql_database || 'asteriskcdrdb',
          serverTimezone: mergedSettings.serverTimezone || '',
          syncIntervalMinutes: Number(mergedSettings.syncIntervalMinutes) || null,
          ssh_host: mergedSettings.ssh_host || null,
          ssh_port: Number(mergedSettings.ssh_port) || 22,
          ssh_username: mergedSettings.ssh_username || null,
          ssh_password: resolvedSshPassword || null,
          ssh_private_key: resolvedSshPrivateKey || null,
          ssh_passphrase: resolvedSshPassphrase || null,
          ssh_base_path: mergedSettings.ssh_base_path || '/var/spool/asterisk/monitor',
          retention_enabled: retentionEnabled,
          retention_days: retentionEnabled ? retentionDays : (rawFreePbxSettings?.retention_days ?? 30),
          retention_run_time: retentionEnabled ? retentionRunTime : (rawFreePbxSettings?.retention_run_time ?? '02:00'),
          retention_next_run_at: retentionEnabled ? nextRunAt : null,
          // Preserve last run/result; job updates these.
          retention_last_run_at: rawFreePbxSettings?.retention_last_run_at ?? null,
          retention_last_result: rawFreePbxSettings?.retention_last_result ?? null,
          // Voicemail
          voicemail_enabled: voicemailEnabled,
          voicemail_base_path: voicemailBasePath || '/var/spool/asterisk/voicemail',
          voicemail_context: voicemailContext || 'default',
          voicemail_folders: voicemailFolders,
          voicemail_sync_interval_minutes: voicemailEnabled ? voicemailSyncIntervalMinutes : (rawFreePbxSettings?.voicemail_sync_interval_minutes ?? 5),
          voicemail_last_sync_at: rawFreePbxSettings?.voicemail_last_sync_at ?? null,
          voicemail_next_sync_at: rawFreePbxSettings?.voicemail_next_sync_at ?? null,
          voicemail_last_result: rawFreePbxSettings?.voicemail_last_result ?? null,
        };
      }

      if (openaiSettings !== undefined) {
        console.log('🔍 DEBUG: Incoming openaiSettings:', JSON.stringify({
          ...openaiSettings,
          api_key: openaiSettings.api_key ? `${openaiSettings.api_key.substring(0, 10)}... (length: ${openaiSettings.api_key.length})` : openaiSettings.api_key
        }));
        console.log('🔍 DEBUG: Raw OpenAI from DB:', JSON.stringify({
          ...rawOpenAISettings,
          api_key: rawOpenAISettings?.api_key ? `${rawOpenAISettings.api_key.substring(0, 10)}... (length: ${rawOpenAISettings.api_key.length})` : rawOpenAISettings?.api_key
        }));

        const baseOpenAI = {
          enabled: false,
          whisper_model: 'whisper-1',
          gpt_model: 'gpt-4o-mini',
          api_key: rawOpenAISettings?.api_key,
        };

        const mergedOpenAISettings = {
          ...baseOpenAI,
          ...openaiSettings,
        };

        console.log('🔍 DEBUG: Merged settings api_key type:', typeof mergedOpenAISettings.api_key);
        console.log('🔍 DEBUG: Incoming api_key type:', typeof openaiSettings.api_key);
        console.log('🔍 DEBUG: Incoming api_key value:', openaiSettings.api_key);

        // Handle API key: empty string means keep existing, undefined/null means remove
        let resolvedApiKey = mergedOpenAISettings.api_key;
        if (openaiSettings.api_key === '') {
          // Empty string means keep existing password
          console.log('🔍 DEBUG: Empty string detected, keeping existing API key');
          resolvedApiKey = rawOpenAISettings?.api_key;
        } else if (openaiSettings.api_key === null || openaiSettings.api_key === undefined) {
          // Null/undefined means clear the password
          console.log('🔍 DEBUG: Null/undefined detected, clearing API key');
          resolvedApiKey = null;
        } else {
          console.log('🔍 DEBUG: New API key provided');
        }

        console.log('🔍 DEBUG: Resolved API key:', resolvedApiKey ? `${resolvedApiKey.substring(0, 10)}... (length: ${resolvedApiKey.length})` : resolvedApiKey);

        const resolveWhisperPricePerMinute = () => {
          // Platform-wide pricing is intended to be stored on the super admin’s OpenAI settings.
          // We still validate/sanitize here to avoid storing invalid values.
          const allow =
            req.user?.role === 'super_admin' &&
            // prevent accidentally writing platform pricing into another user's profile via ?userId
            (!req.query.userId || String(req.query.userId) === String(req.user.id));

          if (!allow) return undefined; // do not write any value

          const raw =
            mergedOpenAISettings.whisper_price_per_minute ??
            mergedOpenAISettings.whisperPricePerMinute;

          if (raw === undefined) return undefined;
          if (raw === null) return null;

          if (typeof raw === 'string' && raw.trim() === '') return null;

          const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
          if (!Number.isFinite(n)) return null;
          if (n < 0) {
            throw new BadRequestError('whisper_price_per_minute must be >= 0');
          }
          return n;
        };

        const whisperPricePerMinute = resolveWhisperPricePerMinute();

        const resolveWhisperOurPricePerMinute = () => {
          // Platform-wide "our price" is intended to be stored on the super admin’s OpenAI settings.
          // Validate/sanitize here to avoid storing invalid values.
          const allow =
            req.user?.role === 'super_admin' &&
            // prevent accidentally writing platform pricing into another user's profile via ?userId
            (!req.query.userId || String(req.query.userId) === String(req.user.id));

          if (!allow) return undefined; // do not write any value

          const raw =
            mergedOpenAISettings.whisper_our_price_per_minute ??
            mergedOpenAISettings.whisperOurPricePerMinute;

          if (raw === undefined) return undefined;
          if (raw === null) return null;

          if (typeof raw === 'string' && raw.trim() === '') return null;

          const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
          if (!Number.isFinite(n)) return null;
          if (n < 0) {
            throw new BadRequestError('whisper_our_price_per_minute must be >= 0');
          }
          return n;
        };

        const whisperOurPricePerMinute = resolveWhisperOurPricePerMinute();

        updates.openaiSettings = {
          enabled: Boolean(mergedOpenAISettings.enabled),
          whisper_model: mergedOpenAISettings.whisper_model || 'whisper-1',
          gpt_model: mergedOpenAISettings.gpt_model || 'gpt-4o-mini',
          api_key: resolvedApiKey,
          analysis_prompt: mergedOpenAISettings.analysis_prompt || null,
          ...(whisperPricePerMinute !== undefined ? { whisper_price_per_minute: whisperPricePerMinute } : {}),
          ...(whisperOurPricePerMinute !== undefined
            ? { whisper_our_price_per_minute: whisperOurPricePerMinute }
            : {}),
        };

        console.log('🔍 DEBUG: Final update payload api_key:', updates.openaiSettings.api_key ? `${updates.openaiSettings.api_key.substring(0, 10)}... (length: ${updates.openaiSettings.api_key.length})` : updates.openaiSettings.api_key);
      }

      if (billingSettings !== undefined) {
        if (req.user?.role !== 'super_admin') {
          throw new ForbiddenError('Only super admins can update billing settings');
        }

        const incoming =
          billingSettings && typeof billingSettings === 'object' && !Array.isArray(billingSettings)
            ? billingSettings
            : {};

        const hasMonthly =
          Object.prototype.hasOwnProperty.call(incoming, 'base_plan_monthly_charge_usd') ||
          Object.prototype.hasOwnProperty.call(incoming, 'basePlanMonthlyChargeUsd');
        const hasIncludedHours =
          Object.prototype.hasOwnProperty.call(incoming, 'base_plan_included_audio_hours') ||
          Object.prototype.hasOwnProperty.call(incoming, 'basePlanIncludedAudioHours');

        const rawMonthly = hasMonthly
          ? (incoming.base_plan_monthly_charge_usd ?? incoming.basePlanMonthlyChargeUsd ?? null)
          : undefined;
        const rawIncludedHours = hasIncludedHours
          ? (incoming.base_plan_included_audio_hours ?? incoming.basePlanIncludedAudioHours ?? null)
          : undefined;

        const parseNonNegativeOrNull = (value, field) => {
          if (value === undefined) return undefined;
          if (value === null) return null;
          if (typeof value === 'string' && value.trim() === '') return null;
          const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
          if (!Number.isFinite(n)) return null;
          if (n < 0) {
            throw new BadRequestError(`${field} must be >= 0`);
          }
          return n;
        };

        const monthly = parseNonNegativeOrNull(rawMonthly, 'base_plan_monthly_charge_usd');
        const includedHours = parseNonNegativeOrNull(rawIncludedHours, 'base_plan_included_audio_hours');

        updates.billingSettings = {
          ...(monthly !== undefined ? { base_plan_monthly_charge_usd: monthly } : {}),
          ...(includedHours !== undefined ? { base_plan_included_audio_hours: includedHours } : {}),
        };
      }

      const user = await User.update(userId, updates);

      console.log(`✅ Updated preferences for user: ${user.email}`);

      res.json({
        success: true,
        data: user,
        message: 'Preferences updated successfully',
      });
    } catch (error) {
      console.error('❌ Error updating preferences:', error.message);
      logger.error({ 
        error: error.message, 
        stack: error.stack,
        userId: req.user?.id 
      }, 'Error updating preferences');
      next(error);
    }
  }

  /**
   * PATCH /api/v1/user/profile
   * Update user contact + company profile fields
   * Supports ?userId=xxx query param for admins
   */
  static async updateProfile(req, res, next) {
    try {
      const userId = UserController.getTargetUserId(req);

      const {
        fullName,
        companyName,
        phone,
        addressLine1,
        addressLine2,
        city,
        state,
        postalCode,
        country,
        // Also accept snake_case (in case callers send DB-style keys)
        full_name,
        company_name,
        address_line1,
        address_line2,
        postal_code,
      } = req.body || {};

      const normalized = {
        full_name: (typeof fullName === 'string' ? fullName : full_name) ?? '',
        company_name: (typeof companyName === 'string' ? companyName : company_name) ?? '',
        phone: phone ?? '',
        address_line1: (typeof addressLine1 === 'string' ? addressLine1 : address_line1) ?? '',
        address_line2: (typeof addressLine2 === 'string' ? addressLine2 : address_line2) ?? null,
        city: city ?? '',
        state: state ?? '',
        postal_code: (typeof postalCode === 'string' ? postalCode : postal_code) ?? '',
        country: country ?? '',
      };

      const requiredFields = [
        ['full_name', normalized.full_name],
        ['company_name', normalized.company_name],
        ['phone', normalized.phone],
        ['address_line1', normalized.address_line1],
        ['city', normalized.city],
        ['state', normalized.state],
        ['postal_code', normalized.postal_code],
        ['country', normalized.country],
      ];

      for (const [key, value] of requiredFields) {
        if (typeof value !== 'string' || value.trim().length === 0) {
          return res.status(400).json({
            success: false,
            message: `${key} is required`,
          });
        }
      }

      // Normalize strings + optional field
      const updates = {
        full_name: normalized.full_name.trim(),
        company_name: normalized.company_name.trim(),
        phone: String(normalized.phone).trim(),
        address_line1: normalized.address_line1.trim(),
        address_line2:
          typeof normalized.address_line2 === 'string' && normalized.address_line2.trim().length > 0
            ? normalized.address_line2.trim()
            : null,
        city: String(normalized.city).trim(),
        state: String(normalized.state).trim(),
        postal_code: normalized.postal_code.trim(),
        country: String(normalized.country).trim(),
      };

      const user = await User.update(userId, updates);

      res.json({
        success: true,
        data: user,
        message: 'Profile updated successfully',
      });
    } catch (error) {
      logger.error(
        { error: error.message, stack: error.stack, userId: req.user?.id },
        'Error updating user profile'
      );
      next(error);
    }
  }
}

