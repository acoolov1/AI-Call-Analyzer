import { Call } from '../models/Call.js';
import { logger } from '../utils/logger.js';
import { ForbiddenError } from '../utils/errors.js';

export class StatsController {
  /**
   * Helper to get target user ID (supports admin access)
   */
  static getTargetUserId(req) {
    const requestedUserId = req.query.userId;
    
    if (!requestedUserId) {
      return req.user.id;
    }
    
    if (!req.user.isAdmin) {
      throw new ForbiddenError('Only admins can access other users\' stats');
    }
    
    logger.info({ adminId: req.user.id, targetUserId: requestedUserId }, 'Admin accessing user stats');
    return requestedUserId;
  }

  /**
   * GET /api/v1/stats
   * Get dashboard statistics
   * Supports ?userId=xxx query param for admins
   */
  static async getStats(req, res, next) {
    try {
      const userId = StatsController.getTargetUserId(req);

      const stats = await Call.getStats(userId);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }
}

