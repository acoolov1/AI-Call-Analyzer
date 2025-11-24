import { FreePbxService } from '../services/freepbx.service.js';
import { getFreePbxSyncStatus, runFreePbxSync } from '../jobs/freepbx-sync.job.js';
import { User } from '../models/User.js';

export class FreePbxController {
  static async status(req, res, next) {
    try {
      const status = getFreePbxSyncStatus();
      const user = await User.findById(req.user.id);
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
      const settings = await User.getFreePbxSettingsRaw(req.user.id);

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

  static async syncNow(req, res, next) {
    try {
      const result = await runFreePbxSync({ reason: 'manual', userId: req.user.id });
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

