import OpenAI from 'openai';
import fs from 'fs';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

export class OpenAIService {
  /**
   * Get platform-wide OpenAI settings (from admin user)
   * This is a platform-level configuration, not per-user
   */
  static async getPlatformSettings() {
    try {
      const { User } = await import('../models/User.js');
      
      // Try to get from the first admin user (you)
      // For now, use DEFAULT_USER_ID from env as the admin
      const adminUserId = process.env.DEFAULT_USER_ID || config.freepbx.defaultUserId;
      
      if (adminUserId) {
        const settings = await User.getOpenAISettingsRaw(adminUserId);
        logger.debug({ hasApiKey: Boolean(settings?.api_key) }, 'Loaded platform OpenAI settings');
        return settings;
      }
      return null;
    } catch (error) {
      logger.warn({ error: error.message }, 'Could not fetch platform OpenAI settings');
      return null;
    }
  }

  /**
   * Get OpenAI settings with user-specific prompt override
   * Uses superadmin's API key/models but user's custom prompt
   * @param {string} userId - The user ID to get custom prompt from
   * @returns {Object} Combined settings (admin's API key + user's prompt)
   */
  static async getSettingsForUser(userId) {
    try {
      const { User } = await import('../models/User.js');
      
      // Get admin settings for API key and models
      const adminSettings = await this.getPlatformSettings();
      
      if (!adminSettings) {
        logger.warn('No admin OpenAI settings found');
        return null;
      }
      
      // Get user's custom prompt if they have one
      if (userId) {
        const userSettings = await User.getOpenAISettingsRaw(userId);
        
        // Merge: Use admin's API key and models, but user's custom prompt
        return {
          ...adminSettings, // API key, models, enabled from admin
          analysis_prompt: userSettings?.analysis_prompt || adminSettings.analysis_prompt,
          analysisPrompt: userSettings?.analysis_prompt || adminSettings.analysis_prompt,
        };
      }
      
      return adminSettings;
    } catch (error) {
      logger.error({ error: error.message, userId }, 'Error getting OpenAI settings for user');
      return await this.getPlatformSettings(); // Fallback to admin settings
    }
  }
  /**
   * Get OpenAI client instance
   * Uses ONLY platform-wide API key configured by admin in settings
   * NO FALLBACK - if not configured, transcription will fail
   */
  static getClient(openaiSettings = null) {
    // REQUIRE admin to configure API key in UI settings - NO fallback to env
    if (!openaiSettings?.api_key) {
      throw new Error('OpenAI is not configured. Administrator must configure API key in settings.');
    }
    
    const apiKey = openaiSettings.api_key;
    // Never log API keys or prefixes (security).
    logger.info('Using admin-configured OpenAI API key');
    
    return new OpenAI({ apiKey });
  }

  /**
   * Test OpenAI connection
   */
  static async testConnection(openaiSettings) {
    try {
      const openai = this.getClient(openaiSettings);
      
      // Make a minimal API call to test the connection
      const response = await openai.models.list();
      
      // Check if we got a valid response
      if (response && response.data) {
        return {
          success: true,
          message: 'Successfully connected to OpenAI API',
          modelsAvailable: response.data.length,
        };
      }
      
      throw new Error('Invalid response from OpenAI API');
    } catch (error) {
      logger.error({ error: error.message }, 'OpenAI connection test failed');
      
      // Handle specific OpenAI error codes
      let errorMessage = 'Failed to connect to OpenAI';
      
      if (error.status === 401) {
        errorMessage = 'Invalid API key. Please check your OpenAI API key and try again.';
      } else if (error.status === 429) {
        errorMessage = 'Rate limit exceeded. Please try again later.';
      } else if (error.status === 500) {
        errorMessage = 'OpenAI server error. Please try again later.';
      } else if (error.message) {
        errorMessage = `Failed to connect to OpenAI: ${error.message}`;
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Transcribe audio using Whisper
   */
  static async transcribeAudio(audioBuffer, tempFilePath = null, openaiSettings = null) {
    let fileToUse = null;
    let actualFilePath = tempFilePath;
    let shouldCleanup = false;
    
    try {
      const openai = this.getClient(openaiSettings);
      
      // Use admin-configured model if set, otherwise default
      let whisperModel = 'whisper-1';
      if (openaiSettings?.whisper_model || openaiSettings?.whisperModel) {
        whisperModel = openaiSettings.whisper_model || openaiSettings.whisperModel;
        logger.info({ model: whisperModel }, 'Using admin-configured Whisper model');
      } else {
        logger.info({ model: whisperModel }, 'Using default Whisper model');
      }
      
      // OpenAI Whisper API requires a File object or readable stream
      // We need to either use a temp file or create a File from the buffer
      if (tempFilePath) {
        // Write buffer to temp file
        fs.writeFileSync(tempFilePath, audioBuffer);
        logger.debug({ tempFilePath, size: audioBuffer.length }, 'Audio written to temp file');
        fileToUse = fs.createReadStream(tempFilePath);
        shouldCleanup = false; // Caller will clean up
      } else {
        // Create a temporary file if no path provided
        actualFilePath = `temp-audio-${Date.now()}.wav`;
        fs.writeFileSync(actualFilePath, audioBuffer);
        fileToUse = fs.createReadStream(actualFilePath);
        shouldCleanup = true;
        logger.debug({ tempPath: actualFilePath, size: audioBuffer.length }, 'Created temp file for transcription');
      }

      logger.info({ fileSize: audioBuffer.length, filePath: actualFilePath, model: whisperModel }, 'Transcribing audio with Whisper');
      
      const transcription = await openai.audio.transcriptions.create({
        file: fileToUse,
        model: whisperModel,
        response_format: 'verbose_json',
        timestamp_granularities: ['word'],
      });

      const transcriptText = transcription.text || '';
      const transcriptWords = transcription.words || [];
      const transcriptSegments = transcription.segments || [];

      logger.info({ textLength: transcriptText.length, words: transcriptWords.length }, 'Transcription completed');

      // Clean up temp file (only if we created it)
      if (shouldCleanup && actualFilePath && fs.existsSync(actualFilePath)) {
        fs.unlinkSync(actualFilePath);
        logger.debug({ filePath: actualFilePath }, 'Temp file deleted');
      }

      return {
        text: transcriptText,
        words: transcriptWords,
        segments: transcriptSegments,
      };
    } catch (error) {
      logger.error({ 
        error: error.message, 
        stack: error.stack,
        status: error.status,
        code: error.code 
      }, 'Error transcribing audio');
      
      // Clean up temp file on error (only if we created it)
      if (shouldCleanup && actualFilePath) {
        try {
          if (fs.existsSync(actualFilePath)) {
            fs.unlinkSync(actualFilePath);
            logger.debug({ filePath: actualFilePath }, 'Temp file deleted after error');
          }
        } catch (cleanupError) {
          // Ignore cleanup errors
          logger.warn({ error: cleanupError.message }, 'Failed to cleanup temp file');
        }
      }
      
      throw error;
    }
  }

  /**
   * Analyze transcript using GPT
   */
  static async analyzeTranscript(transcript, openaiSettings = null) {
    try {
      const openai = this.getClient(openaiSettings);
      
      // Use admin-configured model if set, otherwise default
      let gptModel = 'gpt-4o-mini';
      if (openaiSettings?.gpt_model || openaiSettings?.gptModel) {
        gptModel = openaiSettings.gpt_model || openaiSettings.gptModel;
        logger.info({ model: gptModel }, 'Using admin-configured GPT model');
      } else {
        logger.info({ model: gptModel }, 'Using default GPT model');
      }
      
      // Check for custom analysis prompt in settings
      let analysisPrompt = openaiSettings?.analysis_prompt || openaiSettings?.analysisPrompt;
      
      if (!analysisPrompt) {
        // Use default prompt if no custom prompt is set
        logger.info('Using default analysis prompt');
        analysisPrompt = `
You are an AI call analyst. Using the transcript below, generate a structured report.

TRANSCRIPT:
"${transcript}"

IMPORTANT: Format your response EXACTLY as follows, with each section on a new line starting with the number:

1. **Full Transcript**
[Print the full transcript text exactly as provided. Print it as a dialog with each participant on a new line.]

2. **Summary**
[2-3 sentence summary of the conversation]

3. **Action Items**
[Bulleted list of short action items, one per line starting with - ]

4. **Sentiment**
[One word: positive, negative, or neutral]

5. **Urgent Topics**
[List any urgent topics, or "None" if there are none]

6. **Booking**
[If this call contains an actual conversation of a person trying to book a new booking and is successful, label it Booked. I this call contains an actual conversation of a person trying to book but the booking is unsuccessful, label it Not Booked. If this call contains a conversation of a person rescheduling a booking, label it Rescheduled. If this call contains a conversation of a person canceling a booking, label it Canceled. If this call is related to something other than booking, leave this value blank.]

Make sure each section starts with its number (2., 3., 4., 5., 6.) on a new line and is clearly separated.
`;
      } else {
        logger.info('Using custom analysis prompt from settings');
      }
      
      // Replace ${transcript} placeholder with actual transcript
      const finalPrompt = analysisPrompt.replace(/\$\{transcript\}/g, transcript);

      logger.info({ model: gptModel }, 'Analyzing transcript with GPT');
      
      const response = await openai.chat.completions.create({
        model: gptModel,
        messages: [{ role: 'user', content: finalPrompt }],
      });

      const analysisText = response?.choices?.[0]?.message?.content || '';
      const usage = response?.usage || null;
      const usedModel = response?.model || gptModel;
      logger.debug(
        {
          analysisLength: analysisText.length,
          model: usedModel,
          usage,
        },
        'Analysis completed'
      );
      
      return {
        text: analysisText,
        model: usedModel,
        usage,
      };
    } catch (error) {
      logger.error({ error: error.message }, 'Error analyzing transcript');
      throw error;
    }
  }

  /**
   * Parse analysis text into structured format
   */
  static parseAnalysis(analysisText) {
    const sections = {
      summary: '',
      actionItems: [],
      sentiment: 'neutral',
      urgentTopics: [],
      booking: '',
    };

    if (!analysisText) return sections;

    const lines = analysisText.split('\n');
    let currentSection = null;
    let currentContent = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (/^2\.\s*\*\*?Summary\*\*?/i.test(line) || /^2\.\s*Summary/i.test(line)) {
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = 'summary';
        currentContent = [];
        continue;
      }

      if (/^3\.\s*\*\*?Action\s+Items\*\*?/i.test(line) || /^3\.\s*Action\s+Items/i.test(line)) {
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = 'actionItems';
        currentContent = [];
        continue;
      }

      if (/^4\.\s*\*\*?Sentiment\*\*?/i.test(line) || /^4\.\s*Sentiment/i.test(line)) {
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = 'sentiment';
        currentContent = [];
        continue;
      }

      if (/^5\.\s*\*\*?Urgent\s+Topics\*\*?/i.test(line) || /^5\.\s*Urgent\s+Topics/i.test(line)) {
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = 'urgentTopics';
        currentContent = [];
        continue;
      }

      if (/^6\.\s*\*\*?Booking\*\*?/i.test(line) || /^6\.\s*Booking/i.test(line)) {
        if (currentSection && currentContent.length > 0) {
          sections[currentSection] = currentContent.join('\n').trim();
        }
        currentSection = 'booking';
        currentContent = [];
        continue;
      }

      if (currentSection && line && !/^\d+\./.test(line)) {
        const cleanLine = line.replace(/\*\*/g, '').replace(/^[-*•]\s*/, '').trim();
        if (cleanLine) {
          currentContent.push(cleanLine);
        }
      }
    }

    if (currentSection && currentContent.length > 0) {
      sections[currentSection] = currentContent.join('\n').trim();
    }

    // Process action items
    if (typeof sections.actionItems === 'string') {
      sections.actionItems = sections.actionItems
        .split('\n')
        .map(item => item.replace(/^[-*•]\s*/, '').trim())
        .filter(item => item.length > 0);
    }

    // Process sentiment
    if (typeof sections.sentiment === 'string') {
      const sentiment = sections.sentiment.toLowerCase().trim();
      if (/positive|happy|good|great|excellent|satisfied|pleased/i.test(sentiment)) {
        sections.sentiment = 'positive';
      } else if (/negative|sad|bad|poor|angry|frustrated|disappointed|unhappy/i.test(sentiment)) {
        sections.sentiment = 'negative';
      } else {
        sections.sentiment = 'neutral';
      }
    }

    // Process urgent topics
    if (typeof sections.urgentTopics === 'string') {
      const topics = sections.urgentTopics
        .split('\n')
        .map(topic => topic.replace(/^[-*•]\s*/, '').trim())
        .filter(topic => topic.length > 0 && topic.toLowerCase() !== 'none');
      sections.urgentTopics = topics;
    }

    // Process booking
    if (typeof sections.booking === 'string') {
      const raw = sections.booking.trim();
      if (!raw) {
        sections.booking = '';
      } else if (/^booked$/i.test(raw)) {
        sections.booking = 'Booked';
      } else if (/^not\s*booked$/i.test(raw)) {
        sections.booking = 'Not Booked';
      } else if (/^rescheduled$/i.test(raw)) {
        sections.booking = 'Rescheduled';
      } else if (/^canceled$/i.test(raw)) {
        sections.booking = 'Canceled';
      } else {
        // If model outputs something unexpected, keep empty to avoid false positives.
        sections.booking = '';
      }
    }

    return sections;
  }
}

