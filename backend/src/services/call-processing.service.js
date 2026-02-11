import path from 'path';
import { TwilioService } from './twilio.service.js';
import { FreePbxService } from './freepbx.service.js';
import { OpenAIService } from './openai.service.js';
import { Call } from '../models/Call.js';
import { query } from '../config/database.js';
import { CALL_SOURCE, CALL_STATUS, REDACTION_STATUS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { PciRedactionService } from './pci-redaction.service.js';
import { FreePbxSshService } from './freepbx-ssh.service.js';
import { parseWavDurationSeconds, wavDurationSecondsToBillingSeconds } from '../utils/wav-duration.js';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execFileAsync = promisify(execFile);

export class CallProcessingService {
  /**
   * Process a call recording: download, transcribe, and analyze
   */
  static async processRecording(callId, options = {}) {
    const tempFilePath = path.join(process.cwd(), `temp-recording-${callId}.wav`);

    console.log(`\n🎬 Starting call processing for call ID: ${callId}`);
    if (options.recordingUrl) {
      console.log(`📼 Recording URL override supplied: ${options.recordingUrl}`);
    }
    if (options.recordingPath) {
      console.log(`📁 Recording path override supplied: ${options.recordingPath}`);
    }

    try {
      const call = options.call || await Call.findById(callId);
      const source = options.source || call.source || CALL_SOURCE.TWILIO;
      const recordingUrl = options.recordingUrl || call.recordingUrl;
      const recordingPath = options.recordingPath || call.recordingPath;
      const freepbxSettings = options.freepbxSettings;
      let openaiSettings = options.openaiSettings;

      // If OpenAI settings not provided, get settings with user's custom prompt
      // This uses admin's API key but user's custom analysis prompt
      if (!openaiSettings && call.userId) {
        logger.info({ callId, userId: call.userId }, 'Fetching OpenAI settings with user-specific prompt');
        openaiSettings = await OpenAIService.getSettingsForUser(call.userId);
      }

      // Update status to processing
      console.log('📊 Updating status to processing...');
      await Call.update(callId, null, { status: CALL_STATUS.PROCESSING });

      // Download recording
      console.log('⬇️  Downloading recording...');
      logger.info({ callId, source, recordingUrl, recordingPath }, 'Downloading recording');
      let audioBuffer;
      if (source === CALL_SOURCE.FREEPBX || source === CALL_SOURCE.FREEPBX_CDR) {
        if (!recordingPath && !recordingUrl) {
          throw new Error('FreePBX recording reference missing');
        }
        
        // Use CDR-specific download logic for CDR calls
        if (source === CALL_SOURCE.FREEPBX_CDR) {
          const { FreePbxCdrService } = await import('./freepbx-cdr.service.js');
          audioBuffer = await FreePbxCdrService.downloadRecording(recordingPath || recordingUrl, freepbxSettings);
        } else {
          audioBuffer = await FreePbxService.downloadRecording(recordingPath || recordingUrl, freepbxSettings);
        }
      } else {
        if (!recordingUrl) {
          throw new Error('Recording URL missing for call');
        }
        audioBuffer = await TwilioService.downloadRecording(recordingUrl);
      }
      console.log(`✅ Downloaded ${audioBuffer.length} bytes`);

      // Compute and store actual WAV duration (used for OpenAI usage minutes).
      // This is essentially free: we already downloaded the full buffer for transcription.
      let audioDurationSeconds = null;
      try {
        // Parse from a header window (fast) but allow using full buffer.
        const headerWindow = audioBuffer.subarray(0, Math.min(audioBuffer.length, 64 * 1024));
        const parsedSeconds = parseWavDurationSeconds(headerWindow);
        audioDurationSeconds = wavDurationSecondsToBillingSeconds(parsedSeconds);
        if (audioDurationSeconds && audioDurationSeconds > 0) {
          await Call.update(callId, null, { duration: audioDurationSeconds });
        }
      } catch (e) {
        // Non-fatal: fall back to CDR duration estimates elsewhere.
      }

      // Transcribe
      console.log('🎤 Transcribing audio...');
      logger.info({ callId }, 'Transcribing audio');
      // Track Whisper transcription request attempts (for comparing with OpenAI dashboard model requests).
      try {
        await query(
          `UPDATE calls
           SET whisper_requests = COALESCE(whisper_requests, 0) + 1,
               whisper_requested_at = NOW(),
               updated_at = NOW()
           WHERE id = $1`,
          [callId]
        );
      } catch (e) {
        // Non-fatal: usage tracking only
      }
      const transcription = await OpenAIService.transcribeAudio(audioBuffer, tempFilePath, openaiSettings);
      const transcriptText = transcription?.text || '';
      console.log(`✅ Transcription complete (${transcriptText.length} characters)`);

      // If WAV header parsing failed (common with non-RIFF .wav variants), fall back to ffprobe on the temp file.
      // This stays cheap because the temp file already exists for Whisper.
      if (!audioDurationSeconds || audioDurationSeconds <= 0) {
        try {
          if (fs.existsSync(tempFilePath)) {
            const { stdout } = await execFileAsync('ffprobe', [
              '-v',
              'error',
              '-show_entries',
              'format=duration',
              '-of',
              'default=nw=1:nk=1',
              tempFilePath,
            ]);
            const raw = String(stdout || '').trim();
            const secondsFloat = Number.parseFloat(raw);
            const billingSeconds = wavDurationSecondsToBillingSeconds(secondsFloat);
            if (billingSeconds && billingSeconds > 0) {
              audioDurationSeconds = billingSeconds;
              await Call.update(callId, null, { duration: audioDurationSeconds });
            }
          }
        } catch {
          // non-fatal
        }
      }

      // Detect PCI spans and optionally mute via FFmpeg
      let redactionInfo = {
        status: REDACTION_STATUS.NOT_NEEDED,
        redacted: false,
        segments: [],
        redactedAt: null,
      };
      let sanitizedTranscript = PciRedactionService.sanitizeTranscriptText(transcriptText);
      let workingAudioBuffer = audioBuffer;
      
      // Check if text was sanitized (compare before/after)
      const textWasSanitized = sanitizedTranscript !== transcriptText;

      const detection = PciRedactionService.detectSensitiveSpans(transcriptText, transcription?.words || []);
      if (detection.spans.length > 0) {
        redactionInfo.status = REDACTION_STATUS.PROCESSING;
        // Clean segments for JSON storage (remove undefined/null, keep only serializable data)
        const cleanSegments = detection.spans.map(s => ({
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          reason: String(s.reason || 'unknown'),
        }));
        redactionInfo.segments = cleanSegments;
        await Call.update(callId, null, { 
          redactionStatus: REDACTION_STATUS.PROCESSING, 
          redactedSegments: JSON.stringify(cleanSegments) 
        });

        const redactionResult = await PciRedactionService.redactAudioWithFfmpeg(audioBuffer, detection.spans);
        workingAudioBuffer = redactionResult.buffer;
        redactionInfo.redacted = redactionResult.muted;
        redactionInfo.status = REDACTION_STATUS.COMPLETED;
        redactionInfo.redactedAt = new Date().toISOString();

        // Upload redacted audio back to FreePBX if possible
        if (source === CALL_SOURCE.FREEPBX || source === CALL_SOURCE.FREEPBX_CDR) {
          try {
            if (freepbxSettings) {
              const uploadResult = await FreePbxSshService.uploadAndReplace(
                workingAudioBuffer,
                recordingPath || recordingUrl,
                freepbxSettings
              );
              redactionInfo.uploadTarget = uploadResult.targetPath;
            } else {
              redactionInfo.status = REDACTION_STATUS.FAILED;
              logger.warn({ callId }, 'FreePBX settings missing - unable to upload redacted audio');
            }
          } catch (uploadError) {
            redactionInfo.status = REDACTION_STATUS.FAILED;
            logger.error({ callId, error: uploadError.message }, 'Failed to upload redacted audio to FreePBX');
          }
        }
      } else if (textWasSanitized) {
        // No audio spans, but text was sanitized (e.g., DOB with no detectable audio timeline)
        redactionInfo.status = REDACTION_STATUS.COMPLETED;
        redactionInfo.redacted = true;
        redactionInfo.redactedAt = new Date().toISOString();
      } else {
        // no redaction needed
      }

      // Analyze
      console.log('🤖 Analyzing transcript...');
      logger.info({ callId }, 'Analyzing transcript');
      const analysisResult = await OpenAIService.analyzeTranscript(sanitizedTranscript, openaiSettings);
      const analysisText =
        typeof analysisResult === 'string' ? analysisResult : (analysisResult?.text || '');
      console.log('✅ Analysis complete');

      // Parse analysis
      const parsed = OpenAIService.parseAnalysis(analysisText);

      const usage = typeof analysisResult === 'string' ? null : (analysisResult?.usage || null);
      const usedModel = typeof analysisResult === 'string' ? null : (analysisResult?.model || null);
      const gptInputTokens = usage?.prompt_tokens ?? null;
      const gptOutputTokens = usage?.completion_tokens ?? null;
      const gptTotalTokens = usage?.total_tokens ?? null;

      // Update call with results
      console.log('💾 Saving transcript and analysis...');
      await Call.update(callId, null, {
        transcript: sanitizedTranscript,
        analysis: analysisText,
        status: CALL_STATUS.COMPLETED,
        processedAt: new Date().toISOString(),
        ...(audioDurationSeconds && audioDurationSeconds > 0 ? { duration: audioDurationSeconds } : {}),
        redactionStatus: redactionInfo.status,
        redacted: redactionInfo.redacted,
        redactedSegments: JSON.stringify(redactionInfo.segments),
        redactedAt: redactionInfo.redactedAt,
        ...(usedModel ? { gptModel: usedModel } : {}),
        ...(Number.isFinite(gptInputTokens) ? { gptInputTokens } : {}),
        ...(Number.isFinite(gptOutputTokens) ? { gptOutputTokens } : {}),
        ...(Number.isFinite(gptTotalTokens) ? { gptTotalTokens } : {}),
      });
      console.log('✅ Call updated with transcript and analysis');

      // Save metadata
      console.log('💾 Saving call metadata...');
      await this.saveCallMetadata(callId, parsed);
      console.log('✅ Metadata saved');

      console.log(`\n🎉 Call processing completed successfully for call ID: ${callId}\n`);
      logger.info({ callId }, 'Call processing completed');

      return {
        transcript: sanitizedTranscript,
        analysis: analysisText,
        metadata: parsed,
        transcriptionMeta: {
          words: transcription?.words || [],
          segments: transcription?.segments || [],
        },
        redactedAudioBuffer: workingAudioBuffer,
        redactionInfo,
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
          call_id, summary, sentiment, action_items, urgent_topics, booking, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (call_id) DO UPDATE SET
          summary = EXCLUDED.summary,
          sentiment = EXCLUDED.sentiment,
          action_items = EXCLUDED.action_items,
          urgent_topics = EXCLUDED.urgent_topics,
          booking = EXCLUDED.booking`,
        [
          callId,
          parsed.summary,
          parsed.sentiment,
          JSON.stringify(parsed.actionItems),
          parsed.urgentTopics,
          parsed.booking || null,
        ]
      );
    } catch (error) {
      logger.error({ error: error.message, callId }, 'Error saving call metadata');
      // Don't throw - metadata is optional
    }
  }
}

