import { User } from '../models/User.js';
import { FreepbxExtensionDirectory } from '../models/FreepbxExtensionDirectory.js';
import { ForbiddenError } from '../utils/errors.js';
import { FreepbxRecordingOverridesService } from '../services/freepbx-recording-overrides.service.js';

export class FreepbxRecordingOverridesController {
  static requireSuperAdmin(req) {
    if (req.user?.role !== 'super_admin') {
      throw new ForbiddenError('Super admin only');
    }
  }

  static getTargetUserId(req) {
    const requestedUserId = req.query.userId;
    if (!requestedUserId) return req.user.id;
    // Endpoint itself is super-admin-only, but keep behavior consistent.
    if (!req.user?.isAdmin) {
      throw new ForbiddenError('Only admins can access other users\' settings');
    }
    return String(requestedUserId);
  }

  static async apply(req, res, next) {
    try {
      FreepbxRecordingOverridesController.requireSuperAdmin(req);
      const userId = FreepbxRecordingOverridesController.getTargetUserId(req);

      const freepbxSettings = await User.getFreePbxSettingsRaw(userId);
      if (!freepbxSettings?.ssh_host || !freepbxSettings?.ssh_username || (!freepbxSettings?.ssh_password && !freepbxSettings?.ssh_private_key)) {
        return res.status(400).json({
          success: false,
          error: 'SSH host, username, and password or private key are required to apply recording overrides.',
        });
      }

      const overrides = freepbxSettings?.call_recording_overrides || {};

      // Apply to all known extensions for this user, so unchecked == "Dont Care" is enforced.
      const directory = await FreepbxExtensionDirectory.getByUserId(userId);
      const extNumbers = (Array.isArray(directory?.extensions) ? directory.extensions : [])
        .map((e) => String(e?.number || '').trim())
        .filter(Boolean);

      // Fallback: if directory isn't populated, apply only to keys present in overrides.
      const union = new Set(extNumbers);
      if (!extNumbers.length && overrides && typeof overrides === 'object') {
        for (const k of Object.keys(overrides)) union.add(String(k || '').trim());
      }

      const extensionNumbers = Array.from(union).filter((n) => /^\d+$/.test(n));

      const result = await FreepbxRecordingOverridesService.apply({
        freepbxSettings,
        extensionNumbers,
        overrides,
      });

      return res.json({
        success: true,
        data: {
          userId,
          ...result,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

