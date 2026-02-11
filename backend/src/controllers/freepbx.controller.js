import { FreePbxService } from '../services/freepbx.service.js';
import { FreePbxSshService } from '../services/freepbx-ssh.service.js';
import { FreepbxExtensionsService } from '../services/freepbx-extensions.service.js';
import { getFreePbxSyncStatus, runFreePbxSync } from '../jobs/freepbx-sync.job.js';
import { User } from '../models/User.js';
import { FreepbxExtensionDirectory } from '../models/FreepbxExtensionDirectory.js';
import { ForbiddenError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class FreePbxController {
  /**
   * Helper to get target user ID (supports admin access)
   */
  static getTargetUserId(req) {
    const requestedUserId = req.query.userId;
    
    if (!requestedUserId) {
      return req.user.id;
    }
    
    if (!req.user.isAdmin) {
      throw new ForbiddenError('Only admins can access other users\' settings');
    }
    
    logger.info({ adminId: req.user.id, targetUserId: requestedUserId }, 'Admin accessing FreePBX settings');
    return requestedUserId;
  }

  static async status(req, res, next) {
    try {
      const userId = FreePbxController.getTargetUserId(req);
      const status = getFreePbxSyncStatus();
      const user = await User.findById(userId);
      res.json({
        success: true,
        data: {
          ...status,
          freepbxSettings: user.freepbxSettings,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async testConnection(req, res, next) {
    try {
      const userId = FreePbxController.getTargetUserId(req);
      const settings = await User.getFreePbxSettingsRaw(userId);

      if (!FreePbxService.isEnabled(settings)) {
        return res.status(400).json({
          success: false,
          error: 'FreePBX integration is disabled. Please configure credentials first.',
        });
      }

      const result = await FreePbxService.testConnection(settings);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  static async testSshConnection(req, res, next) {
    try {
      const userId = FreePbxController.getTargetUserId(req);
      const settings = await User.getFreePbxSettingsRaw(userId);

      if (!settings?.ssh_host || !settings?.ssh_username || (!settings?.ssh_password && !settings?.ssh_private_key)) {
        return res.status(400).json({
          success: false,
          error: 'SSH host, username, and password or private key are required to test SSH connection.',
        });
      }

      // One SSH connection: validate base path and refresh extensions directory.
      const result = await FreepbxExtensionsService.testAndFetchExtensions(settings);
      await FreepbxExtensionDirectory.upsert(userId, result.extensions || []);
      res.json({
        success: true,
        data: {
          ok: true,
          pathExists: result.pathExists,
          basePath: result.basePath,
          extensionsUpdated: (result.extensions || []).length,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async recordingsStats(req, res, next) {
    try {
      const userId = FreePbxController.getTargetUserId(req);
      const settings = await User.getFreePbxSettingsRaw(userId);

      if (!settings?.ssh_host || !settings?.ssh_username || (!settings?.ssh_password && !settings?.ssh_private_key)) {
        return res.status(400).json({
          success: false,
          error: 'SSH host, username, and password or private key are required to get recordings folder stats.',
        });
      }

      const result = await FreePbxSshService.getFolderStats(settings);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  static async syncNow(req, res, next) {
    try {
      const userId = FreePbxController.getTargetUserId(req);
      const result = await runFreePbxSync({ reason: 'manual', userId });
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

