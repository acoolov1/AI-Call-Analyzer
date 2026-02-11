import { User } from '../models/User.js';
import { FreepbxExtensionDirectory } from '../models/FreepbxExtensionDirectory.js';
import { FreepbxExtensionsService } from '../services/freepbx-extensions.service.js';
import { ForbiddenError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class FreepbxExtensionsController {
  static getTargetUserId(req) {
    const requestedUserId = req.query.userId;
    if (!requestedUserId) return req.user.id;
    if (!req.user.isAdmin) {
      throw new ForbiddenError('Only admins can access other users\' settings');
    }
    return requestedUserId;
  }

  static requireSuperAdmin(req) {
    if (req.user?.role !== 'super_admin') {
      throw new ForbiddenError('Super admin only');
    }
  }

  static async getDirectory(req, res, next) {
    try {
      FreepbxExtensionsController.requireSuperAdmin(req);
      const userId = FreepbxExtensionsController.getTargetUserId(req);
      const data = await FreepbxExtensionDirectory.getByUserId(userId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  static async refreshDirectory(req, res, next) {
    try {
      FreepbxExtensionsController.requireSuperAdmin(req);
      const userId = FreepbxExtensionsController.getTargetUserId(req);
      const settings = await User.getFreePbxSettingsRaw(userId);

      if (!settings?.ssh_host || !settings?.ssh_username || (!settings?.ssh_password && !settings?.ssh_private_key)) {
        return res.status(400).json({
          success: false,
          error: 'SSH host, username, and password or private key are required to fetch extensions.',
        });
      }

      const result = await FreepbxExtensionsService.testAndFetchExtensions(settings);
      const stored = await FreepbxExtensionDirectory.upsert(userId, result.extensions || []);

      logger.info(
        { userId, extensionCount: (result.extensions || []).length, pathExists: result.pathExists },
        'Refreshed FreePBX extension directory'
      );

      res.json({
        success: true,
        data: {
          ok: true,
          pathExists: result.pathExists,
          basePath: result.basePath,
          extensions: stored.extensions,
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

