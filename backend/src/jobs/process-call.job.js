import { queueTranscription, queueAnalysis } from './queue.js';
import { Call } from '../models/Call.js';
import { CALL_STATUS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

/**
 * Process a call recording using background jobs
 */
export async function processCallWithJobs(callId, recordingUrl) {
  console.log(`\n🚀 processCallWithJobs called for call ${callId}`);
  console.log(`   Recording URL: ${recordingUrl}`);
  
  try {
    // Update status to processing
    console.log('📊 Updating call status to processing...');
    await Call.update(callId, null, { status: CALL_STATUS.PROCESSING });
    console.log('✅ Status updated to processing');

    // Queue transcription job (or process synchronously if Redis unavailable)
    console.log('📤 Queueing transcription...');
    const result = await queueTranscription(callId, recordingUrl);
    
    // If result is a job (Redis available), wait for it and queue analysis
    if (result && typeof result.waitUntilFinished === 'function') {
      console.log('✅ Transcription job queued (Redis available)');
      result.waitUntilFinished().then(async (transcriptionResult) => {
        console.log('✅ Transcription job completed');
        if (transcriptionResult && transcriptionResult.transcript) {
          console.log(`   Transcript length: ${transcriptionResult.transcript.length} characters`);
          // Queue analysis job
          console.log('📤 Queueing analysis...');
          await queueAnalysis(callId, transcriptionResult.transcript);
          console.log('✅ Analysis job queued');
        } else {
          console.error('❌ No transcript in transcription result!');
        }
      }).catch((error) => {
        console.error('❌ Error in transcription job chain:', error.message);
        logger.error({ error: error.message, callId }, 'Error in transcription job chain');
        Call.update(callId, null, { status: CALL_STATUS.FAILED }).catch(err => {
          logger.error({ error: err.message, callId }, 'Failed to update call status');
        });
      });
      return result;
    }
    
    // If we get here, processing was synchronous (Redis unavailable)
    console.log('✅ Processing completed synchronously (Redis unavailable)');
    console.log('   Result:', result ? 'Success' : 'No result');
    // The call has already been processed
    return result;
  } catch (error) {
    console.error('\n❌ ERROR in processCallWithJobs ❌');
    console.error(`Call ID: ${callId}`);
    console.error(`Error: ${error.message}`);
    if (error.stack) {
      console.error(`Stack: ${error.stack}`);
    }
    console.error('');
    
    logger.error({ error: error.message, stack: error.stack, callId }, 'Error queueing call processing');
    try {
      await Call.update(callId, null, { status: CALL_STATUS.FAILED });
      console.log('✅ Call status updated to FAILED');
    } catch (updateError) {
      console.error('❌ Failed to update call status:', updateError.message);
    }
    throw error;
  }
}

