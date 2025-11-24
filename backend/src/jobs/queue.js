import { Queue, Worker } from 'bullmq';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Redis connection config
let connection = null;
let redisAvailable = false;

// Test Redis connection
async function testRedisConnection() {
  try {
    const Redis = (await import('ioredis')).default;
    const testRedis = new Redis(config.redis.url, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // Don't retry
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    });
    
    // Suppress error events during test
    testRedis.on('error', () => {}); // Silently ignore errors during test
    
    await testRedis.connect();
    await testRedis.ping();
    await testRedis.quit();
    
    // If we get here, Redis is available
    connection = {
      host: config.redis.url.includes('://') 
        ? new URL(config.redis.url).hostname 
        : 'localhost',
      port: config.redis.url.includes('://')
        ? parseInt(new URL(config.redis.url).port) || 6379
        : 6379,
      password: config.redis.url.includes('@')
        ? config.redis.url.split('@')[0].split(':')[2]
        : undefined,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null;
        return Math.min(times * 200, 2000);
      },
    };
    
    redisAvailable = true;
    return true;
  } catch (error) {
    redisAvailable = false;
    return false;
  }
}

// Lazy initialization - only create queues if Redis is available
let transcriptionQueue = null;
let analysisQueue = null;

// Workers
let transcriptionWorker = null;
let analysisWorker = null;

/**
 * Initialize workers
 */
export async function initializeWorkers() {
  // Test Redis connection first
  const redisOk = await testRedisConnection();
  
  if (!redisOk) {
    logger.warn('Redis not available - background jobs disabled. App will work but call processing will be synchronous.');
    return false;
  }
  
  // Create queues only if Redis is available
  if (!transcriptionQueue) {
    transcriptionQueue = new Queue('transcription', { connection });
    analysisQueue = new Queue('analysis', { connection });
  }
  
  // Transcription worker
  transcriptionWorker = new Worker(
    'transcription',
    async (job) => {
      const { CallProcessingService } = await import('../services/call-processing.service.js');
      const { callId, recordingUrl } = job.data;
      
      logger.info({ jobId: job.id, callId }, 'Processing transcription job');
      
      // Download and transcribe
      const { TwilioService } = await import('../services/twilio.service.js');
      const { OpenAIService } = await import('../services/openai.service.js');
      const path = await import('path');
      const fs = await import('fs');
      
      const tempFilePath = path.join(process.cwd(), `temp-recording-${callId}.wav`);
      const audioBuffer = await TwilioService.downloadRecording(recordingUrl);
      const transcript = await OpenAIService.transcribeAudio(audioBuffer, tempFilePath);
      
      // Clean up temp file
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      
      return { transcript };
    },
    {
      connection,
      concurrency: 2,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  transcriptionWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Transcription job completed');
  });

  transcriptionWorker.on('failed', (job, err) => {
    logger.error({ jobId: job.id, error: err.message }, 'Transcription job failed');
  });

  // Analysis worker
  analysisWorker = new Worker(
    'analysis',
    async (job) => {
      const { CallProcessingService } = await import('../services/call-processing.service.js');
      const { callId, transcript } = job.data;
      
      logger.info({ jobId: job.id, callId }, 'Processing analysis job');
      
      // Analyze transcript
      const { OpenAIService } = await import('../services/openai.service.js');
      const analysis = await OpenAIService.analyzeTranscript(transcript);
      const parsed = OpenAIService.parseAnalysis(analysis);
      
      // Update call and save metadata
      const { Call } = await import('../models/Call.js');
      const { CALL_STATUS } = await import('../utils/constants.js');
      
      await Call.update(callId, null, {
        transcript,
        analysis,
        status: CALL_STATUS.COMPLETED,
        processedAt: new Date().toISOString(),
      });
      
      await CallProcessingService.saveCallMetadata(callId, parsed);
      
      return { analysis, metadata: parsed };
    },
    {
      connection,
      concurrency: 2,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  analysisWorker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Analysis job completed');
  });

  analysisWorker.on('failed', (job, err) => {
    logger.error({ jobId: job.id, error: err.message }, 'Analysis job failed');
  });

  logger.info('Background job workers initialized with Redis');
  return true;
}

/**
 * Queue transcription job
 */
export async function queueTranscription(callId, recordingUrl) {
  if (!redisAvailable || !transcriptionQueue) {
    // Fallback to synchronous processing
    logger.info({ callId }, 'Redis not available, processing synchronously');
    const { CallProcessingService } = await import('../services/call-processing.service.js');
    return await CallProcessingService.processRecording(callId, { recordingUrl });
  }
  
  const job = await transcriptionQueue.add(
    'transcribe',
    { callId, recordingUrl },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    }
  );

  logger.info({ jobId: job.id, callId }, 'Queued transcription job');
  return job;
}

/**
 * Queue analysis job
 */
export async function queueAnalysis(callId, transcript) {
  if (!redisAvailable || !analysisQueue) {
    // Fallback to synchronous processing
    logger.info({ callId }, 'Redis not available, processing synchronously');
    const { OpenAIService } = await import('../services/openai.service.js');
    const { Call } = await import('../models/Call.js');
    const { CallProcessingService } = await import('../services/call-processing.service.js');
    const { CALL_STATUS } = await import('../utils/constants.js');
    
    const analysis = await OpenAIService.analyzeTranscript(transcript);
    const parsed = OpenAIService.parseAnalysis(analysis);
    
    await Call.update(callId, null, {
      transcript,
      analysis,
      status: CALL_STATUS.COMPLETED,
      processedAt: new Date().toISOString(),
    });
    
    await CallProcessingService.saveCallMetadata(callId, parsed);
    return { analysis, metadata: parsed };
  }
  
  const job = await analysisQueue.add(
    'analyze',
    { callId, transcript },
    {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    }
  );

  logger.info({ jobId: job.id, callId }, 'Queued analysis job');
  return job;
}

/**
 * Close all queues and workers
 */
export async function closeQueues() {
  if (transcriptionQueue) {
    await transcriptionQueue.close().catch(() => {});
  }
  if (analysisQueue) {
    await analysisQueue.close().catch(() => {});
  }
  if (transcriptionWorker) {
    await transcriptionWorker.close().catch(() => {});
  }
  if (analysisWorker) {
    await analysisWorker.close().catch(() => {});
  }
  logger.info('All queues and workers closed');
}

