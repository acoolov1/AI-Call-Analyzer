import { OpenAIService } from '../services/openai.service.js';
import { logger } from '../utils/logger.js';

export class OpenAIController {
  /**
   * Test OpenAI connection
   */
  static async testConnection(req, res, next) {
    try {
      const { apiKey, whisperModel, gptModel } = req.body;
      
      // If no API key provided in request, try to get saved one from user settings
      let finalApiKey = apiKey;
      
      if (!finalApiKey || !finalApiKey.trim()) {
        const { User } = await import('../models/User.js');
        const savedSettings = await User.getOpenAISettingsRaw(req.user.id);
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

      logger.info({ userId: req.user.id }, 'Testing OpenAI connection');

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

