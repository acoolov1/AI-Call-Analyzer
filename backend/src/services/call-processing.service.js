import path from 'path';
import { TwilioService } from './twilio.service.js';
import { OpenAIService } from './openai.service.js';
import { Call } from '../models/Call.js';
import { query } from '../config/database.js';
import { CALL_STATUS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export class CallProcessingService {
  /**
   * Process a call recording: download, transcribe, and analyze
   */
  static async processRecording(callId, recordingUrl) {
    const tempFilePath = path.join(process.cwd(), `temp-recording-${callId}.wav`);

    console.log(`\n🎬 Starting call processing for call ID: ${callId}`);
    console.log(`📼 Recording URL: ${recordingUrl}\n`);

    try {
      // Update status to processing
      console.log('📊 Updating status to processing...');
      await Call.update(callId, null, { status: CALL_STATUS.PROCESSING });

      // Download recording
      console.log('⬇️  Downloading recording...');
      logger.info({ callId, recordingUrl }, 'Downloading recording');
      const audioBuffer = await TwilioService.downloadRecording(recordingUrl);
      console.log(`✅ Downloaded ${audioBuffer.length} bytes`);

      // Transcribe
      console.log('🎤 Transcribing audio...');
      logger.info({ callId }, 'Transcribing audio');
      const transcript = await OpenAIService.transcribeAudio(audioBuffer, tempFilePath);
      console.log(`✅ Transcription complete (${transcript.length} characters)`);

      // Analyze
      console.log('🤖 Analyzing transcript...');
      logger.info({ callId }, 'Analyzing transcript');
      const analysis = await OpenAIService.analyzeTranscript(transcript);
      console.log('✅ Analysis complete');

      // Parse analysis
      const parsed = OpenAIService.parseAnalysis(analysis);

      // Update call with results
      console.log('💾 Saving transcript and analysis...');
      await Call.update(callId, null, {
        transcript,
        analysis,
        status: CALL_STATUS.COMPLETED,
        processedAt: new Date().toISOString(),
      });
      console.log('✅ Call updated with transcript and analysis');

      // Save metadata
      console.log('💾 Saving call metadata...');
      await this.saveCallMetadata(callId, parsed);
      console.log('✅ Metadata saved');

      console.log(`\n🎉 Call processing completed successfully for call ID: ${callId}\n`);
      logger.info({ callId }, 'Call processing completed');

      return {
        transcript,
        analysis,
        metadata: parsed,
      };
    } catch (error) {
      console.error('\n❌ ERROR PROCESSING CALL ❌');
      console.error(`Call ID: ${callId}`);
      console.error(`Error: ${error.message}`);
      if (error.stack) {
        console.error(`Stack: ${error.stack}`);
      }
      if (error.status) {
        console.error(`Status: ${error.status}`);
      }
      if (error.code) {
        console.error(`Code: ${error.code}`);
      }
      console.error('');
      
      logger.error({ 
        error: error.message, 
        stack: error.stack,
        status: error.status,
        code: error.code,
        callId 
      }, 'Error processing call');
      
      // Update status to failed
      try {
        await Call.update(callId, null, { status: CALL_STATUS.FAILED });
        console.log('✅ Call status updated to FAILED');
      } catch (updateError) {
        console.error('❌ Failed to update call status:', updateError.message);
        logger.error({ error: updateError.message, callId }, 'Failed to update call status to failed');
      }

      throw error;
    } finally {
      // Clean up temp file if it exists
      try {
        const fs = await import('fs');
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupError) {
        logger.warn({ error: cleanupError.message, tempFilePath }, 'Failed to cleanup temp file');
      }
    }
  }

  /**
   * Save call metadata to call_metadata table
   */
  static async saveCallMetadata(callId, parsed) {
    try {
      await query(
        `INSERT INTO call_metadata (
          call_id, summary, sentiment, action_items, urgent_topics, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (call_id) DO UPDATE SET
          summary = EXCLUDED.summary,
          sentiment = EXCLUDED.sentiment,
          action_items = EXCLUDED.action_items,
          urgent_topics = EXCLUDED.urgent_topics`,
        [
          callId,
          parsed.summary,
          parsed.sentiment,
          JSON.stringify(parsed.actionItems),
          parsed.urgentTopics,
        ]
      );
    } catch (error) {
      logger.error({ error: error.message, callId }, 'Error saving call metadata');
      // Don't throw - metadata is optional
    }
  }
}

