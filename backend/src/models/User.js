import { query } from '../config/database.js';
import { NotFoundError } from '../utils/errors.js';

export class User {
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

  static async update(id, updates) {
    const allowedFields = [
      'subscription_tier',
      'stripe_customer_id',
      'stripe_subscription_id',
      'timezone',
      'twilio_settings',
      'freepbx_settings',
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
                   key;

      if (allowedFields.includes(dbKey)) {
        // Handle JSONB fields
        if ((dbKey === 'twilio_settings' || dbKey === 'freepbx_settings') && typeof value === 'object') {
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
    const defaultFreePbxSettings = {
      enabled: false,
      host: '',
      port: 8089,
      username: '',
      tls: true,
      syncIntervalMinutes: 10,
      hasPassword: false,
    };

    const sanitizedFreePbx = {
      enabled: Boolean(rawFreePbx.enabled),
      host: rawFreePbx.host || '',
      port: rawFreePbx.port || 8089,
      username: rawFreePbx.username || '',
      tls: rawFreePbx.tls !== false,
      syncIntervalMinutes: rawFreePbx.syncIntervalMinutes || 10,
      hasPassword: Boolean(rawFreePbx.password),
    };

    return {
      id: row.id,
      email: row.email,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      subscriptionTier: row.subscription_tier,
      stripeCustomerId: row.stripe_customer_id,
      stripeSubscriptionId: row.stripe_subscription_id,
      timezone: row.timezone || 'UTC',
      twilioSettings: row.twilio_settings || defaultTwilioSettings,
      freepbxSettings: {
        ...defaultFreePbxSettings,
        ...sanitizedFreePbx,
      },
    };
  }
}

