import { FreePbxCdrService } from '../services/freepbx-cdr.service.js';
import { runFreePbxCdrSync, getFreePbxCdrSyncStatus } from '../jobs/freepbx-cdr-sync.job.js';
import { User } from '../models/User.js';
import { logger } from '../utils/logger.js';
import { Call } from '../models/Call.js';
import { CALL_SOURCE } from '../utils/constants.js';

export class FreePbxCdrController {
  static async testConnection(req, res, next) {
    try {
      const userId = req.user.id;
      const freepbxSettings = await User.getFreePbxSettingsRaw(userId);

      if (!FreePbxCdrService.isEnabled(freepbxSettings)) {
        return res.status(400).json({
          error: 'FreePBX CDR integration is not configured. Please provide MySQL credentials.',
        });
      }

      const result = await FreePbxCdrService.testConnection(freepbxSettings);
      
      logger.info({ userId, result }, 'FreePBX CDR connection test successful');
      
      res.json({
        success: true,
        message: 'Successfully connected to FreePBX CDR database',
        ...result,
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'FreePBX CDR connection test failed');
      next(error);
    }
  }

  static async syncNow(req, res, next) {
    try {
      const userId = req.user.id;
      
      logger.info({ userId }, 'Manual FreePBX CDR sync triggered');
      
      // Trigger sync asynchronously
      runFreePbxCdrSync({ reason: 'manual', userId }).catch((error) => {
        logger.error({ error: error.message, userId }, 'FreePBX CDR sync failed');
      });

      res.json({
        success: true,
        message: 'FreePBX CDR sync started',
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'Failed to start FreePBX CDR sync');
      next(error);
    }
  }

  static async getStatus(req, res, next) {
    try {
      const userId = req.user.id;
      const freepbxSettings = await User.getFreePbxSettingsRaw(userId);
      const syncStatus = getFreePbxCdrSyncStatus();

      res.json({
        freepbxCdrSettings: {
          enabled: FreePbxCdrService.isEnabled(freepbxSettings),
          mysqlHost: freepbxSettings?.mysql_host || freepbxSettings?.host || null,
          mysqlDatabase: freepbxSettings?.mysql_database || 'asteriskcdrdb',
        },
        lastRun: syncStatus.lastRun,
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'Failed to get FreePBX CDR status');
      next(error);
    }
  }

  static async getCdrCalls(req, res, next) {
    try {
      const userId = req.user.id;
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per page

      // Fetch calls from database that have source = 'freepbx-cdr'
      const calls = await Call.findByUserId(userId, { 
        limit, 
        offset: (page - 1) * limit,
        source: CALL_SOURCE.FREEPBX_CDR,
      });

      // Get total count for pagination
      const totalResult = await Call.countBySource(userId, CALL_SOURCE.FREEPBX_CDR);
      const total = totalResult || 0;

      res.json({
        calls,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'Failed to get CDR calls');
      next(error);
    }
  }
}

