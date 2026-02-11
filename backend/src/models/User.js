import { query } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';

export class User {
  /**
   * Fetch the minimal auth context needed for request authorization.
   * This is used by middleware to avoid pulling the full user profile on every request.
   */
  static async getAuthContext(userId) {
    const result = await query(
      'SELECT id, role, can_use_app, can_use_freepbx_manager FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const role = row.role || 'user';
    return {
      id: row.id,
      role,
      isAdmin: role === 'admin' || role === 'super_admin',
      canUseApp: row.can_use_app !== false,
      canUseFreepbxManager: row.can_use_freepbx_manager === true,
    };
  }

  static async isSuperAdmin(userId) {
    const result = await query('SELECT role FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) return false;
    return result.rows[0].role === 'super_admin';
  }
  static async findById(id) {
    const result = await query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User');
    }

    return this.mapRowToUser(result.rows[0]);
  }

  static async findByEmail(email) {
    const result = await query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToUser(result.rows[0]);
  }

  static async getFreePbxSettingsRaw(id) {
    const result = await query(
      'SELECT freepbx_settings FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User');
    }

    return result.rows[0].freepbx_settings || null;
  }

  /**
   * Merge a partial object into freepbx_settings without rewriting the whole JSONB.
   * This is useful for backfilling newly introduced keys.
   */
  static async mergeFreePbxSettings(id, partial) {
    const safe = partial && typeof partial === 'object' ? partial : {};
    const result = await query(
      `UPDATE users
       SET freepbx_settings = COALESCE(freepbx_settings, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE id = $2
       RETURNING freepbx_settings`,
      [JSON.stringify(safe), id]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError('User');
    }
    return result.rows[0].freepbx_settings || null;
  }

  static async getOpenAISettingsRaw(id) {
    const result = await query(
      'SELECT openai_settings FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User');
    }

    return result.rows[0].openai_settings || null;
  }

  static async getBillingSettingsRaw(id) {
    const result = await query(
      'SELECT billing_settings FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User');
    }

    return result.rows[0].billing_settings || null;
  }

  static async create(data) {
    const {
      id,
      email,
      subscriptionTier = 'free',
      stripeCustomerId,
      stripeSubscriptionId,
    } = data;

    const result = await query(
      `INSERT INTO users (
        id, email, subscription_tier, stripe_customer_id, stripe_subscription_id,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *`,
      [id, email, subscriptionTier, stripeCustomerId, stripeSubscriptionId]
    );

    return this.mapRowToUser(result.rows[0]);
  }

  static async findAll() {
    const result = await query(
      `SELECT
        id,
        email,
        role,
        can_use_app,
        can_use_freepbx_manager,
        subscription_tier,
        full_name,
        company_name,
        timezone,
        created_at,
        updated_at
      FROM users
      ORDER BY created_at DESC`
    );
    return result.rows.map(row => ({
      id: row.id,
      email: row.email,
      role: row.role || 'user',
      canUseApp: row.can_use_app !== false,
      canUseFreepbxManager: row.can_use_freepbx_manager === true,
      subscriptionTier: row.subscription_tier,
      fullName: row.full_name || '',
      companyName: row.company_name || '',
      timezone: row.timezone || 'UTC',
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  static async isAdmin(userId) {
    const result = await query(
      'SELECT role FROM users WHERE id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      return false;
    }
    
    return result.rows[0].role === 'admin' || result.rows[0].role === 'super_admin';
  }

  static async updateRole(userId, role) {
    if (!['super_admin', 'admin', 'user'].includes(role)) {
      throw new Error('Invalid role. Must be "super_admin", "admin" or "user"');
    }

    const result = await query(
      `UPDATE users 
       SET role = $1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING *`,
      [role, userId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User');
    }

    return this.mapRowToUser(result.rows[0]);
  }

  static async update(id, updates) {
    const allowedFields = [
      'subscription_tier',
      'stripe_customer_id',
      'stripe_subscription_id',
      'timezone',
      'full_name',
      'company_name',
      'phone',
      'address_line1',
      'address_line2',
      'city',
      'state',
      'postal_code',
      'country',
      'tos_accepted_at',
      'privacy_accepted_at',
      'tos_version',
      'privacy_version',
      'twilio_settings',
      'freepbx_settings',
      'openai_settings',
      'billing_settings',
      'role',
      'can_use_app',
      'can_use_freepbx_manager',
    ];

    const fields = [];
    const values = [];
    let paramIndex = 1;

    Object.entries(updates).forEach(([key, value]) => {
      const dbKey = key === 'subscriptionTier' ? 'subscription_tier' :
                   key === 'stripeCustomerId' ? 'stripe_customer_id' :
                   key === 'stripeSubscriptionId' ? 'stripe_subscription_id' :
                   key === 'twilioSettings' ? 'twilio_settings' :
                   key === 'freepbxSettings' ? 'freepbx_settings' :
                   key === 'openaiSettings' ? 'openai_settings' :
                   key === 'billingSettings' ? 'billing_settings' :
                   key === 'canUseApp' ? 'can_use_app' :
                   key === 'canUseFreepbxManager' ? 'can_use_freepbx_manager' :
                   key;

      if (allowedFields.includes(dbKey)) {
        // Handle JSONB fields
        if (
          (dbKey === 'twilio_settings' ||
            dbKey === 'freepbx_settings' ||
            dbKey === 'openai_settings' ||
            dbKey === 'billing_settings') &&
          typeof value === 'object'
        ) {
          fields.push(`${dbKey} = $${paramIndex}::jsonb`);
          values.push(JSON.stringify(value));
        } else {
          fields.push(`${dbKey} = $${paramIndex}`);
          values.push(value);
        }
        paramIndex++;
      }
    });

    if (fields.length === 0) {
      throw new Error('No valid fields to update');
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    const sql = `
      UPDATE users
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await query(sql, values);

    if (result.rows.length === 0) {
      throw new NotFoundError('User');
    }

    return this.mapRowToUser(result.rows[0]);
  }

  static mapRowToUser(row) {
    // Default Twilio settings
    const defaultTwilioSettings = {
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

    const rawFreePbx = row.freepbx_settings || {};
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
    const defaultFreePbxSettings = {
      enabled: false,
      host: '',
      port: 8089,
      username: '',
      tls: true,
      syncIntervalMinutes: 10,
      hasPassword: false,
      call_history_include_inbound: true,
      call_history_include_outbound: true,
      call_history_include_internal: true,
      call_history_excluded_inbound_extensions: [],
      call_history_excluded_outbound_extensions: [],
      call_history_excluded_internal_extensions: [],
      call_recording_overrides: {},
      ssh_host: '',
      ssh_port: 22,
      ssh_username: '',
      ssh_base_path: '/var/spool/asterisk/monitor',
      hasSshPassword: false,
      hasSshPrivateKey: false,
      // Recording retention (days-only, once/day)
      retention_enabled: false,
      retention_days: 30,
      retention_run_time: '02:00',
      retention_next_run_at: null,
      retention_last_run_at: null,
      retention_last_result: null,
      // Voicemail (FreePBX/Asterisk)
      voicemail_enabled: false,
      voicemail_base_path: '/var/spool/asterisk/voicemail',
      voicemail_context: 'default',
      voicemail_folders: ['INBOX', 'Old'],
      voicemail_sync_interval_minutes: 5,
      voicemail_last_sync_at: null,
      voicemail_next_sync_at: null,
      voicemail_last_result: null,
      voicemail_sync_in_progress: false,
      voicemail_sync_started_at: null,
    };

    const sanitizedFreePbx = {
      enabled: Boolean(rawFreePbx.enabled),
      integration_date: rawFreePbx.integration_date || null,
      host: rawFreePbx.host || '',
      port: rawFreePbx.port || 8089,
      username: rawFreePbx.username || '',
      tls: rawFreePbx.tls !== false,
      syncIntervalMinutes: rawFreePbx.syncIntervalMinutes || 10,
      hasPassword: Boolean(rawFreePbx.password),
      call_history_include_inbound: rawFreePbx.call_history_include_inbound !== false,
      call_history_include_outbound: rawFreePbx.call_history_include_outbound !== false,
      call_history_include_internal: rawFreePbx.call_history_include_internal !== false,
      call_history_excluded_inbound_extensions: Array.isArray(rawFreePbx.call_history_excluded_inbound_extensions)
        ? rawFreePbx.call_history_excluded_inbound_extensions
        : [],
      call_history_excluded_outbound_extensions: Array.isArray(rawFreePbx.call_history_excluded_outbound_extensions)
        ? rawFreePbx.call_history_excluded_outbound_extensions
        : [],
      call_history_excluded_internal_extensions: Array.isArray(rawFreePbx.call_history_excluded_internal_extensions)
        ? rawFreePbx.call_history_excluded_internal_extensions
        : [],
      call_recording_overrides: sanitizeRecordingOverrides(rawFreePbx.call_recording_overrides),
      mysql_host: rawFreePbx.mysql_host || rawFreePbx.host || '',
      mysql_port: rawFreePbx.mysql_port || 3306,
      mysql_username: rawFreePbx.mysql_username || '',
      mysql_database: rawFreePbx.mysql_database || 'asteriskcdrdb',
      hasMysqlPassword: Boolean(rawFreePbx.mysql_password),
      serverTimezone: rawFreePbx.serverTimezone || '',
      ssh_host: rawFreePbx.ssh_host || rawFreePbx.host || '',
      ssh_port: rawFreePbx.ssh_port || 22,
      ssh_username: rawFreePbx.ssh_username || '',
      ssh_base_path: rawFreePbx.ssh_base_path || '/var/spool/asterisk/monitor',
      hasSshPassword: Boolean(rawFreePbx.ssh_password),
      hasSshPrivateKey: Boolean(rawFreePbx.ssh_private_key),
      retention_enabled: Boolean(rawFreePbx.retention_enabled),
      retention_days: Number.parseInt(String(rawFreePbx.retention_days ?? 30), 10) || 30,
      retention_run_time: String(rawFreePbx.retention_run_time || '02:00'),
      retention_next_run_at: rawFreePbx.retention_next_run_at || null,
      retention_last_run_at: rawFreePbx.retention_last_run_at || null,
      retention_last_result: rawFreePbx.retention_last_result || null,
      voicemail_enabled: Boolean(rawFreePbx.voicemail_enabled),
      voicemail_base_path: String(rawFreePbx.voicemail_base_path || '/var/spool/asterisk/voicemail'),
      voicemail_context: String(rawFreePbx.voicemail_context || 'default'),
      voicemail_folders: Array.isArray(rawFreePbx.voicemail_folders)
        ? rawFreePbx.voicemail_folders.map((x) => String(x || '').trim()).filter(Boolean)
        : ['INBOX', 'Old'],
      voicemail_sync_interval_minutes:
        Number.parseInt(String(rawFreePbx.voicemail_sync_interval_minutes ?? 5), 10) || 5,
      voicemail_last_sync_at: rawFreePbx.voicemail_last_sync_at || null,
      voicemail_next_sync_at: rawFreePbx.voicemail_next_sync_at || null,
      voicemail_last_result: rawFreePbx.voicemail_last_result || null,
      voicemail_sync_in_progress: Boolean(rawFreePbx.voicemail_sync_in_progress),
      voicemail_sync_started_at: rawFreePbx.voicemail_sync_started_at || null,
    };

    const rawOpenAI = row.openai_settings || {};
    const defaultOpenAISettings = {
      enabled: false,
      whisperModel: 'whisper-1',
      gptModel: 'gpt-4o-mini',
      hasApiKey: false,
      whisperPricePerMinute: null,
      whisperOurPricePerMinute: null,
    };

    const rawWhisperPrice =
      rawOpenAI.whisper_price_per_minute ?? rawOpenAI.whisperPricePerMinute ?? null;
    const whisperPricePerMinute = (() => {
      if (rawWhisperPrice === null || rawWhisperPrice === undefined) return null;
      const n =
        typeof rawWhisperPrice === 'number'
          ? rawWhisperPrice
          : Number.parseFloat(String(rawWhisperPrice));
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    })();

    const rawWhisperOurPrice =
      rawOpenAI.whisper_our_price_per_minute ?? rawOpenAI.whisperOurPricePerMinute ?? null;
    const whisperOurPricePerMinute = (() => {
      if (rawWhisperOurPrice === null || rawWhisperOurPrice === undefined) return null;
      const n =
        typeof rawWhisperOurPrice === 'number'
          ? rawWhisperOurPrice
          : Number.parseFloat(String(rawWhisperOurPrice));
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    })();

    const sanitizedOpenAI = {
      enabled: Boolean(rawOpenAI.enabled),
      whisperModel: rawOpenAI.whisper_model || rawOpenAI.whisperModel || 'whisper-1',
      gptModel: rawOpenAI.gpt_model || rawOpenAI.gptModel || 'gpt-4o-mini',
      hasApiKey: Boolean(rawOpenAI.api_key),
      analysisPrompt: rawOpenAI.analysis_prompt || rawOpenAI.analysisPrompt || '',
      whisperPricePerMinute,
      whisperOurPricePerMinute,
    };

    const rawBilling = row.billing_settings || {};
    const defaultBillingSettings = {
      basePlanMonthlyChargeUsd: null,
      basePlanIncludedAudioHours: null,
    };
    const sanitizeNonNegativeNumberOrNull = (v) => {
      if (v === null || v === undefined) return null;
      const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
      if (!Number.isFinite(n) || n < 0) return null;
      return n;
    };
    const basePlanMonthlyChargeUsd = sanitizeNonNegativeNumberOrNull(
      rawBilling.base_plan_monthly_charge_usd ?? rawBilling.basePlanMonthlyChargeUsd ?? null
    );
    const basePlanIncludedAudioHours = sanitizeNonNegativeNumberOrNull(
      rawBilling.base_plan_included_audio_hours ?? rawBilling.basePlanIncludedAudioHours ?? null
    );
    const sanitizedBilling = {
      basePlanMonthlyChargeUsd,
      basePlanIncludedAudioHours,
    };

    return {
      id: row.id,
      email: row.email,
      role: row.role || 'user',
      isAdmin: (row.role === 'admin' || row.role === 'super_admin'),
      canUseApp: row.can_use_app !== false,
      canUseFreepbxManager: row.can_use_freepbx_manager === true,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      subscriptionTier: row.subscription_tier,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      timezone: row.timezone || 'UTC',
      fullName: row.full_name || '',
      companyName: row.company_name || '',
      phone: row.phone || '',
      addressLine1: row.address_line1 || '',
      addressLine2: row.address_line2 || '',
      city: row.city || '',
      state: row.state || '',
      postalCode: row.postal_code || '',
      country: row.country || '',
      tosAcceptedAt: row.tos_accepted_at ? row.tos_accepted_at.toISOString() : null,
      privacyAcceptedAt: row.privacy_accepted_at ? row.privacy_accepted_at.toISOString() : null,
      tosVersion: row.tos_version || '',
      privacyVersion: row.privacy_version || '',
      twilioSettings: row.twilio_settings || defaultTwilioSettings,
      freepbxSettings: {
        ...defaultFreePbxSettings,
        ...sanitizedFreePbx,
      },
      openaiSettings: {
        ...defaultOpenAISettings,
        ...sanitizedOpenAI,
      },
      billingSettings: {
        ...defaultBillingSettings,
        ...sanitizedBilling,
      },
    };
  }
}

