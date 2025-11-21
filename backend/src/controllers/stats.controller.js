import { Call } from '../models/Call.js';
import { logger } from '../utils/logger.js';

export class StatsController {
  /**
   * GET /api/v1/stats
   * Get dashboard statistics
   */
  static async getStats(req, res, next) {
    try {
      const userId = req.user.id;

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

