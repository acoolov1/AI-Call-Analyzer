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
      const { timezone, twilioSettings } = req.body;

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
      if (twilioSettings !== undefined) {
        // Get current user to merge with existing settings
        const currentUser = await User.findById(userId);
        
        // Ensure we have a valid base object with defaults
        const baseSettings = currentUser.twilioSettings || {
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

