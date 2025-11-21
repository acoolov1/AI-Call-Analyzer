import { Call } from '../models/Call.js';
import { TwilioService } from '../services/twilio.service.js';
import { CallProcessingService } from '../services/call-processing.service.js';
import { CALL_STATUS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';
import { query } from '../config/database.js';

export class TwilioController {
  /**
   * POST /api/v1/webhooks/twilio/voice
   * Handle incoming call webhook
   */
    static async handleVoiceWebhook(req, res, next) {
    // Always log that we received the webhook
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🔔 VOICE WEBHOOK RECEIVED');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Time:', new Date().toISOString());
    console.log('═══════════════════════════════════════════════════════════\n');
    
    try {
      const callerNumber = req.body.From || req.body.Caller || 'Unknown';
      const callerName = req.body.FromName || req.body.CallerName || null;
      const callSid = req.body.CallSid;

      console.log(`📞 Call SID: ${callSid}`);
      console.log(`📞 Caller: ${callerNumber}`);
      
      logger.info({
        callSid,
        callerNumber,
        callerName,
        body: req.body,
        headers: {
          host: req.headers.host,
          'x-forwarded-host': req.headers['x-forwarded-host'],
          'x-forwarded-proto': req.headers['x-forwarded-proto'],
        },
      }, 'Incoming call webhook');

      // Get host and protocol
      let host = req.headers['host'];
      if (!host) {
        host = req.headers['x-forwarded-host'];
      }
      if (!host) {
        host = req.get('host');
      }

      const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';

      if (!host) {
        logger.error('No host header found in voice webhook');
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Please configure your webhook URL with a proper host.</Say>
  <Hangup/>
</Response>`;
        res.type('text/xml');
        return res.status(200).send(twiml);
      }

      // For now, use a default user ID (will be replaced with proper user lookup)
      // TODO: Map Twilio number to user account
      const defaultUserId = process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000000';

      // Log which user ID is being used
      console.log(`\n👤 Using DEFAULT_USER_ID: ${defaultUserId}`);
      console.log(`   (From env: ${process.env.DEFAULT_USER_ID || 'NOT SET - using fallback'})`);

      // Ensure default user exists and fetch their settings
      console.log('👤 Checking default user...');
      const userCheck = await query('SELECT id, twilio_settings FROM users WHERE id = $1', [defaultUserId]);
      
      let userSettings = {};
      if (userCheck.rows.length === 0) {
        // Create default user if it doesn't exist
        console.log('⚠️  Default user not found, creating it...');
        logger.warn({ defaultUserId }, 'Default user not found, creating it');
        await query(
          `INSERT INTO users (id, email, subscription_tier, created_at, updated_at)
           VALUES ($1, $2, 'free', NOW(), NOW())
           ON CONFLICT (id) DO NOTHING`,
          [defaultUserId, process.env.DEFAULT_USER_EMAIL || 'default@example.com']
        );
        console.log('✅ Default user created');
        logger.info({ defaultUserId }, 'Created default user');
      } else {
        console.log('✅ Default user exists');
        userSettings = userCheck.rows[0].twilio_settings || {};
        console.log('⚙️  User Twilio settings:', JSON.stringify(userSettings, null, 2));
      }

      // Create call record
      console.log('💾 Creating call record...');
      const call = await Call.create({
        userId: defaultUserId,
        callSid,
        callerNumber,
        callerName,
        status: CALL_STATUS.PENDING,
      });

      console.log(`✅ Call record created: ${call.id}`);
      logger.info({ callId: call.id, callSid }, 'Call record created');

      // Generate recording complete URL
      // Use the full API path for better compatibility with signature verification
      const recordingCompleteUrl = `${protocol}://${host}/api/v1/webhooks/twilio/recording?CallSid=${encodeURIComponent(callSid)}`;
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('📞 RECORDING WEBHOOK CONFIGURATION:');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('Recording Callback URL:', recordingCompleteUrl);
      console.log('Protocol:', protocol);
      console.log('Host:', host);
      console.log('Call SID:', callSid);
      console.log('═══════════════════════════════════════════════════════════\n');

      // Generate TwiML
      console.log('📝 Generating TwiML...');
      let twiml;
      try {
        twiml = TwilioService.generateForwardTwiML({
          callSid,
          host,
          protocol,
          recordingCompleteUrl,
          userSettings,
        });
        console.log('✅ TwiML generated successfully');
      } catch (error) {
        console.error('❌ Error generating TwiML:', error.message);
        logger.error({ error: error.message }, 'Error generating TwiML');
        // Return a simple TwiML that just says something and hangs up
        twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling. Your call is being processed.</Say>
  <Record 
    recordingStatusCallback="${recordingCompleteUrl}"
    recordingStatusCallbackMethod="POST"
    maxLength="3600"
    finishOnKey="#"/>
  <Say>Thank you. Goodbye.</Say>
  <Hangup/>
</Response>`;
      }

      console.log('📤 Sending TwiML response...');
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('📝 GENERATED TWIML:');
      console.log('═══════════════════════════════════════════════════════════');
      console.log(twiml);
      console.log('═══════════════════════════════════════════════════════════\n');
      res.type('text/xml');
      res.status(200).send(twiml);
      console.log('✅ TwiML sent successfully!\n');
    } catch (error) {
      // Enhanced error logging
      logger.error({ 
        error: error.message, 
        stack: error.stack,
        callSid: req.body?.CallSid,
        callerNumber: req.body?.From,
        body: req.body,
      }, 'Error handling voice webhook');
      
      // Console log for immediate visibility (always show, even if logger is quiet)
      console.error('\n');
      console.error('═══════════════════════════════════════════════════════════');
      console.error('❌ WEBHOOK ERROR ❌');
      console.error('═══════════════════════════════════════════════════════════');
      console.error('Time:', new Date().toISOString());
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
      if (req.body) {
        console.error('Request body:', JSON.stringify(req.body, null, 2));
      }
      console.error('Headers:', JSON.stringify(req.headers, null, 2));
      console.error('═══════════════════════════════════════════════════════════');
      console.error('\n');
      
      // Also write to a log file for debugging
      try {
        const fs = await import('fs');
        const path = await import('path');
        const logFile = path.join(process.cwd(), 'webhook-errors.log');
        const logEntry = `\n[${new Date().toISOString()}] WEBHOOK ERROR\nMessage: ${error.message}\nStack: ${error.stack}\nBody: ${JSON.stringify(req.body, null, 2)}\n========================\n`;
        fs.appendFileSync(logFile, logEntry);
      } catch (logError) {
        // Ignore log file errors
      }
      
      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>An error occurred processing your call. Please try again later.</Say>
  <Hangup/>
</Response>`;
      res.type('text/xml');
      res.status(200).send(errorTwiml);
    }
  }

  /**
   * POST /api/v1/webhooks/twilio/recording
   * Handle recording complete webhook
   */
  static async handleRecordingWebhook(req, res, next) {
    console.log('\n🎙️  RECORDING WEBHOOK RECEIVED\n');
    try {
      const recordingUrl = req.body.RecordingUrl;
      let callSid = req.query.CallSid || req.body.CallSid;

      console.log('📼 Recording URL:', recordingUrl);
      console.log('📞 Call SID:', callSid);
      console.log('Body:', JSON.stringify(req.body, null, 2));
      
      logger.info({ recordingUrl, callSid }, 'Recording complete webhook');

      if (!recordingUrl) {
        logger.error('No RecordingUrl in recording webhook');
        return res.status(400).json({ error: 'No RecordingUrl provided' });
      }

      // If no CallSid, try to get it from recording
      if (!callSid && recordingUrl) {
        try {
          const recordingSidMatch = recordingUrl.match(/Recordings\/([^\/\?]+)/);
          if (recordingSidMatch) {
            const recordingSid = recordingSidMatch[1];
            const recording = await TwilioService.getRecordingDetails(recordingSid);
            callSid = recording.callSid;
            logger.info({ callSid, recordingSid }, 'Retrieved CallSid from recording');
          }
        } catch (error) {
          logger.warn({ error: error.message }, 'Could not get CallSid from recording');
        }
      }

      // Find call by CallSid
      console.log('🔍 Looking for call with CallSid:', callSid);
      let call = null;
      if (callSid) {
        call = await Call.findByCallSid(callSid);
      }

      if (!call) {
        console.error('❌ Call not found for recording!');
        logger.error({ callSid }, 'Call not found for recording');
        return res.status(404).json({ error: 'Call not found' });
      }

      console.log(`✅ Found call: ${call.id}`);
      
      // Update call with recording URL
      console.log('💾 Updating call with recording URL...');
      await Call.update(call.id, null, {
        recordingUrl,
        recordingSid: recordingUrl.match(/Recordings\/([^\/\?]+)/)?.[1],
      });
      console.log('✅ Call updated with recording URL');

      // Queue processing job (async)
      console.log('🚀 Starting call processing...');
      const { processCallWithJobs } = await import('../jobs/process-call.job.js');
      processCallWithJobs(call.id, recordingUrl)
        .then(() => {
          console.log('✅ Call processing started successfully');
        })
        .catch(error => {
          console.error('❌ Background processing failed:', error.message);
          logger.error({ error: error.message, callId: call.id }, 'Background processing failed');
        });

      console.log('✅ Recording webhook processed successfully\n');
      res.status(200).json({ success: true, message: 'Recording queued for processing' });
    } catch (error) {
      logger.error({ error: error.message }, 'Error handling recording webhook');
      next(error);
    }
  }

  /**
   * POST /api/v1/webhooks/twilio/dial-complete
   * Handle dial complete webhook (optional)
   */
  static async handleDialComplete(req, res, next) {
    try {
      const { DialCallStatus, DialCallDuration, CallSid } = req.body;

      logger.info({
        callSid: CallSid,
        dialStatus: DialCallStatus,
        duration: DialCallDuration,
      }, 'Dial complete webhook');

      // Update call duration if available
      if (CallSid && DialCallDuration) {
        try {
          const call = await Call.findByCallSid(CallSid);
          if (call) {
            await Call.update(call.id, null, {
              duration: parseInt(DialCallDuration, 10),
            });
          }
        } catch (error) {
          logger.warn({ error: error.message, callSid: CallSid }, 'Could not update call duration');
        }
      }

      res.status(200).send('OK');
    } catch (error) {
      logger.error({ error: error.message }, 'Error handling dial complete webhook');
      next(error);
    }
  }
}

