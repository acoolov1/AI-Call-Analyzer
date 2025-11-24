import { User } from '../models/User.js';
import { logger } from '../utils/logger.js';

export class UserController {
  /**
   * GET /api/v1/user
   * Get current authenticated user information
   */
  static async getCurrentUser(req, res, next) {
    try {
      const userId = req.user.id;

      console.log(`\n👤 Fetching user info for user: ${userId}`);

      const user = await User.findById(userId);

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
   * PATCH /api/v1/user/preferences
   * Update user preferences (timezone, twilioSettings, etc.)
   */
  static async updatePreferences(req, res, next) {
    try {
      const userId = req.user.id;
      const { timezone, twilioSettings, freepbxSettings } = req.body;

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
      if (twilioSettings !== undefined || freepbxSettings !== undefined) {
        currentUser = await User.findById(userId);
      }
      if (freepbxSettings !== undefined) {
        rawFreePbxSettings = await User.getFreePbxSettingsRaw(userId);
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
        const baseFreePbx = {
          enabled: false,
          host: '',
          port: 8089,
          username: '',
          tls: true,
          password: rawFreePbxSettings?.password,
          syncIntervalMinutes: 10,
        };

        const mergedSettings = {
          ...baseFreePbx,
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

        let resolvedPassword = baseFreePbx.password;
        if (typeof freepbxSettings.password === 'string') {
          resolvedPassword = freepbxSettings.password.length > 0 ? freepbxSettings.password : null;
        }

        if (mergedSettings.enabled) {
          if (!mergedSettings.host || !mergedSettings.username || !resolvedPassword) {
            return res.status(400).json({
              success: false,
              message: 'host, username, and password are required when FreePBX is enabled',
            });
          }
        }

        updates.freepbxSettings = {
          enabled: Boolean(mergedSettings.enabled),
          host: mergedSettings.host,
          port: Number(mergedSettings.port),
          username: mergedSettings.username,
          tls: mergedSettings.tls !== false,
          password: resolvedPassword,
          syncIntervalMinutes: Number(mergedSettings.syncIntervalMinutes),
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
}

