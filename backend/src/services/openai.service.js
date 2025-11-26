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
        return settings;
      }
      
      return null;
    } catch (error) {
      logger.warn({ error: error.message }, 'Could not fetch platform OpenAI settings');
      return null;
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
      console.log('❌ OpenAI not configured - Admin must configure API key in /settings/openai');
      throw new Error('OpenAI is not configured. Administrator must configure API key in settings.');
    }
    
    const apiKey = openaiSettings.api_key;
    console.log(`✅ Using OpenAI API key from: ADMIN SETTINGS (${apiKey.substring(0, 10)}...)`);
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

      console.log(`🎤 Calling OpenAI Whisper API (${whisperModel})...`);
      logger.info({ fileSize: audioBuffer.length, filePath: actualFilePath, model: whisperModel }, 'Transcribing audio with Whisper');
      
      const transcription = await openai.audio.transcriptions.create({
        file: fileToUse,
        model: whisperModel,
      });

      console.log(`✅ Transcription received: ${transcription.text.length} characters`);
      logger.info({ textLength: transcription.text.length }, 'Transcription completed');

      // Clean up temp file (only if we created it)
      if (shouldCleanup && actualFilePath && fs.existsSync(actualFilePath)) {
        fs.unlinkSync(actualFilePath);
        logger.debug({ filePath: actualFilePath }, 'Temp file deleted');
      }

      return transcription.text;
    } catch (error) {
      console.error('❌ Transcription error:', error.message);
      if (error.status) {
        console.error(`   Status: ${error.status}`);
      }
      if (error.code) {
        console.error(`   Code: ${error.code}`);
      }
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
      
      const analysisPrompt = `
You are an AI call analyst. Using the transcript below, generate a structured report.

TRANSCRIPT:
"${transcript}"

IMPORTANT: Format your response EXACTLY as follows, with each section on a new line starting with the number:

1. **Full Transcript**
[Print the full transcript text exactly as provided]

2. **Summary**
[2-3 sentence summary of the conversation]

3. **Action Items**
[Bulleted list of action items, one per line starting with - or *. If an action item is urgent, include the word "urgent" or "URGENT" in that item]

4. **Sentiment**
[One word or short phrase: positive, negative, or neutral]

5. **Urgent Topics**
[List any urgent topics, or "None" if there are none]

Make sure each section starts with its number (2., 3., 4., 5.) on a new line and is clearly separated.
`;

      logger.info({ model: gptModel }, 'Analyzing transcript with GPT');
      
      const response = await openai.chat.completions.create({
        model: gptModel,
        messages: [{ role: 'user', content: analysisPrompt }],
      });

      const analysisText = response.choices[0].message.content;
      logger.debug({ analysisLength: analysisText.length }, 'Analysis completed');
      
      return analysisText;
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

    return sections;
  }
}

