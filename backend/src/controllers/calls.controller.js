import { Call } from '../models/Call.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export class CallsController {
  /**
   * GET /api/v1/calls
   * List calls for authenticated user
   */
  static async listCalls(req, res, next) {
    try {
      const userId = req.user.id;
      const { limit = 50, offset = 0, status } = req.query;

      console.log(`\n📞 Fetching calls for user: ${userId}`);

      const calls = await Call.findByUserId(userId, {
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        status,
      });

      console.log(`✅ Found ${calls.length} calls for user ${userId}`);

      // If no calls found for this user, also check default user (for migration period)
      if (calls.length === 0) {
        const defaultUserId = process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000000';
        console.log(`⚠️  No calls for user ${userId}, checking default user ${defaultUserId}`);
        const defaultUserCalls = await Call.findByUserId(defaultUserId, {
          limit: parseInt(limit, 10),
          offset: parseInt(offset, 10),
          status,
        });
        
        if (defaultUserCalls.length > 0) {
          console.log(`📋 Found ${defaultUserCalls.length} calls for default user - these need to be associated with your account`);
          console.log(`💡 Run: npm run associate-calls your-email@example.com`);
        }
      }

      res.json({
        success: true,
        data: calls,
        pagination: {
          limit: parseInt(limit, 10),
          offset: parseInt(offset, 10),
          count: calls.length,
        },
      });
    } catch (error) {
      console.error('❌ Error listing calls:', error.message);
      next(error);
    }
  }

  /**
   * GET /api/v1/calls/:id
   * Get call details
   */
  static async getCall(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const call = await Call.findById(id, userId);

      res.json({
        success: true,
        data: call,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/calls/:id
   * Delete a call
   */
  static async deleteCall(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      await Call.delete(id, userId);

      res.json({
        success: true,
        message: 'Call deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/v1/calls/:id/retry
   * Retry failed call processing
   */
  static async retryCall(req, res, next) {
    try {
      const userId = req.user.id;
      const { id } = req.params;

      const call = await Call.findById(id, userId);

      if (!call.recordingUrl) {
        throw new NotFoundError('Recording URL not found for this call');
      }

      // Import here to avoid circular dependency
      const { CallProcessingService } = await import('../services/call-processing.service.js');
      
      // Queue processing job (will be implemented with background jobs)
      // For now, process synchronously
      await CallProcessingService.processRecording(call.id, {
        source: call.source,
        recordingUrl: call.recordingUrl,
        recordingPath: call.recordingPath,
        call,
      });

      const updatedCall = await Call.findById(id, userId);

      res.json({
        success: true,
        data: updatedCall,
        message: 'Call processing retried successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/calls/:id
   * Delete a single call
   */
  static async deleteCall(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      logger.info({ callId: id, userId }, 'Deleting call');

      // Verify ownership
      const call = await Call.findById(id);
      if (!call) {
        throw new NotFoundError('Call not found');
      }

      if (call.userId !== userId) {
        throw new BadRequestError('You do not have permission to delete this call');
      }

      // Delete the call
      await Call.delete(id);

      logger.info({ callId: id }, 'Call deleted successfully');

      res.json({
        success: true,
        message: 'Call deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/calls/bulk
   * Delete multiple calls
   */
  static async bulkDeleteCalls(req, res, next) {
    try {
      const { callIds } = req.body;
      const userId = req.user.id;

      if (!Array.isArray(callIds) || callIds.length === 0) {
        throw new BadRequestError('callIds must be a non-empty array');
      }

      logger.info({ count: callIds.length, userId }, 'Bulk deleting calls');

      // Verify ownership of all calls
      const calls = await Promise.all(
        callIds.map(id => Call.findById(id))
      );

      const unauthorizedCalls = calls.filter(call => call && call.userId !== userId);
      if (unauthorizedCalls.length > 0) {
        throw new BadRequestError('You do not have permission to delete some of these calls');
      }

      const notFoundCalls = calls.filter(call => !call);
      if (notFoundCalls.length > 0) {
        logger.warn({ count: notFoundCalls.length }, 'Some calls not found');
      }

      // Delete all valid calls
      const validCallIds = calls.filter(call => call).map(call => call.id);
      await Call.bulkDelete(validCallIds);

      logger.info({ deleted: validCallIds.length }, 'Bulk delete completed');

      res.json({
        success: true,
        message: `${validCallIds.length} call(s) deleted successfully`,
        deleted: validCallIds.length,
      });
    } catch (error) {
      next(error);
    }
  }
}

