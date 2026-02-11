import { OpenAIService } from '../services/openai.service.js';
import { logger } from '../utils/logger.js';
import { ForbiddenError } from '../utils/errors.js';

export class OpenAIController {
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
    
    logger.info({ adminId: req.user.id, targetUserId: requestedUserId }, 'Admin accessing OpenAI settings');
    return requestedUserId;
  }

  /**
   * Test OpenAI connection
   * Supports ?userId=xxx query param for admins
   */
  static async testConnection(req, res, next) {
    try {
      const userId = OpenAIController.getTargetUserId(req);
      const { apiKey, whisperModel, gptModel } = req.body;
      
      // If no API key provided in request, try to get saved one from user settings
      let finalApiKey = apiKey;
      
      if (!finalApiKey || !finalApiKey.trim()) {
        const { User } = await import('../models/User.js');
        const savedSettings = await User.getOpenAISettingsRaw(userId);
        finalApiKey = savedSettings?.api_key;
        
        if (!finalApiKey) {
          return res.status(400).json({
            success: false,
            error: 'API key is required. Please enter an API key or save your settings first.',
          });
        }
      }

      const openaiSettings = {
        api_key: finalApiKey,
        whisper_model: whisperModel || 'whisper-1',
        gpt_model: gptModel || 'gpt-4o-mini',
      };

      logger.info({ userId }, 'Testing OpenAI connection');

      const result = await OpenAIService.testConnection(openaiSettings);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error({ error: error.message, userId: req.user?.id }, 'OpenAI connection test failed');
      next(error);
    }
  }
}

