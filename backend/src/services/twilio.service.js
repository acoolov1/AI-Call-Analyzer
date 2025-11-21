import twilio from 'twilio';
import axios from 'axios';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

export class TwilioService {
  /**
   * Lookup caller name using Twilio Lookup API v2
   */
  static async lookupCallerName(phoneNumber) {
    if (!phoneNumber || phoneNumber === 'Unknown') {
      return null;
    }

    try {
      const lookupUrl = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneNumber)}`;
      const response = await axios.get(lookupUrl, {
        params: {
          Fields: 'caller_name',
        },
        auth: {
          username: config.twilio.accountSid,
          password: config.twilio.authToken,
        },
      });

      const name = response.data?.caller_name?.caller_name || null;
      if (name) {
        logger.debug({ phoneNumber, name }, 'Retrieved caller name from Lookup API');
      }
      return name;
    } catch (error) {
      if (error.response?.status === 404) {
        logger.debug({ phoneNumber }, 'No caller name found in Lookup API');
      } else {
        logger.warn({ error: error.message, phoneNumber }, 'Error looking up caller name');
      }
      return null;
    }
  }

  /**
   * Get call details from Twilio API
   */
  static async getCallDetails(callSid) {
    try {
      const call = await client.calls(callSid).fetch();
      return {
        callSid: call.sid,
        from: call.from,
        to: call.to,
        status: call.status,
        duration: call.duration,
        startTime: call.startTime,
        endTime: call.endTime,
      };
    } catch (error) {
      logger.error({ error: error.message, callSid }, 'Error fetching call details from Twilio');
      throw error;
    }
  }

  /**
   * Get recording details from Twilio API
   */
  static async getRecordingDetails(recordingSid) {
    try {
      const recording = await client.recordings(recordingSid).fetch();
      return {
        recordingSid: recording.sid,
        callSid: recording.callSid,
        duration: recording.duration,
        url: recording.uri.replace('.json', '.wav'),
      };
    } catch (error) {
      logger.error({ error: error.message, recordingSid }, 'Error fetching recording details from Twilio');
      throw error;
    }
  }

  /**
   * Download recording audio
   */
  static async downloadRecording(recordingUrl) {
    try {
      const urlWithExtension = `${recordingUrl}.wav`;
      const response = await axios.get(urlWithExtension, {
        responseType: 'arraybuffer',
        auth: {
          username: config.twilio.accountSid,
          password: config.twilio.authToken,
        },
      });

      return Buffer.from(response.data);
    } catch (error) {
      logger.error({ error: error.message, recordingUrl }, 'Error downloading recording');
      throw error;
    }
  }

  /**
   * Generate TwiML for call forwarding with user-specific settings
   * @param {Object} params - Parameters for TwiML generation
   * @param {string} params.callSid - Twilio Call SID
   * @param {string} params.host - Request host
   * @param {string} params.protocol - Request protocol (http/https)
   * @param {string} params.recordingCompleteUrl - Callback URL for recording completion
   * @param {Object} params.userSettings - User's Twilio settings
   * @returns {string} TwiML XML response
   */
  static generateForwardTwiML({ callSid, host, protocol, recordingCompleteUrl, userSettings = {} }) {
    // Default settings
    const settings = {
      forwardingEnabled: userSettings.forwardingEnabled ?? true,
      forwardPhoneNumber: userSettings.forwardPhoneNumber || config.twilio.businessPhoneNumber || '',
      recordingEnabled: userSettings.recordingEnabled ?? true,
      callTimeout: userSettings.callTimeout || 30,
      customGreeting: userSettings.customGreeting || '',
      playRecordingBeep: userSettings.playRecordingBeep ?? true,
      maxRecordingLength: userSettings.maxRecordingLength || 3600,
      finishOnKey: userSettings.finishOnKey || '#',
      afterHoursMessage: userSettings.afterHoursMessage || '',
      recordingMode: userSettings.recordingMode || 'record-from-answer',
    };

    // If forwarding is enabled and phone number is configured, forward the call
    if (settings.forwardingEnabled && settings.forwardPhoneNumber) {
      const dialCompleteUrl = `${protocol}://${host}/api/v1/webhooks/twilio/dial-complete?CallSid=${encodeURIComponent(callSid || '')}`;

      let twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>`;

      // Add custom greeting if provided
      if (settings.customGreeting) {
        twiml += `
  <Say>${this.escapeXml(settings.customGreeting)}</Say>`;
      }

      // Add Dial with recording if enabled
      if (settings.recordingEnabled) {
        twiml += `
  <Dial 
    record="${settings.recordingMode}"
    recordingStatusCallback="${recordingCompleteUrl}"
    recordingStatusCallbackMethod="POST"
    action="${dialCompleteUrl}"
    timeout="${settings.callTimeout}"
    callerId="${callSid}">
    <Number>${settings.forwardPhoneNumber}</Number>
  </Dial>`;
      } else {
        twiml += `
  <Dial 
    action="${dialCompleteUrl}"
    timeout="${settings.callTimeout}"
    callerId="${callSid}">
    <Number>${settings.forwardPhoneNumber}</Number>
  </Dial>`;
      }

      twiml += `
</Response>`;
      return twiml;
    }
    
    // If no forwarding, just record the call directly or play message
    let twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>`;

    const greeting = settings.customGreeting || 'Thank you for calling. Your call is being recorded.';
    twiml += `
  <Say>${this.escapeXml(greeting)}</Say>`;

    // Only record if recording is enabled
    if (settings.recordingEnabled) {
      twiml += `
  <Record 
    recordingStatusCallback="${recordingCompleteUrl}"
    recordingStatusCallbackMethod="POST"
    maxLength="${settings.maxRecordingLength}"
    finishOnKey="${settings.finishOnKey}"
    playBeep="${settings.playRecordingBeep}"/>`;
    }

    twiml += `
  <Say>Thank you. Goodbye.</Say>
  <Hangup/>
</Response>`;

    return twiml;
  }

  /**
   * Escape XML special characters to prevent XML injection
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  static escapeXml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

