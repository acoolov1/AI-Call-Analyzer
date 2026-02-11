import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/env.js';
import { getPool, closePool } from './config/database.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { metricsMiddleware, getMetrics } from './middleware/metrics.middleware.js';
import routes from './routes/index.js';
import { initializeWorkers, closeQueues } from './jobs/queue.js';
import { scheduleFreePbxSync } from './jobs/freepbx-sync.job.js';
import { scheduleFreePbxCdrSync } from './jobs/freepbx-cdr-sync.job.js';
import { scheduleFreePbxMetricsSync } from './jobs/freepbx-metrics-sync.job.js';
import { scheduleFreePbxRetention } from './jobs/freepbx-retention.job.js';
import { scheduleFreePbxVoicemailJobs } from './jobs/freepbx-voicemail.job.js';
import { scheduleSystemMetricsHistorySampling, stopSystemMetricsHistorySampling } from './jobs/system-metrics-history.job.js';

const app = express();

// Trust first proxy (e.g. nginx, Next.js) so X-Forwarded-For is accepted and rate limiter does not throw
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: config.cors.frontendUrl,
  credentials: true,
}));

// Body parsing
// Twilio sends webhooks as application/x-www-form-urlencoded
// We need to parse this before signature verification
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Special handling for Twilio webhooks - ensure body is parsed correctly
app.use((req, res, next) => {
  if (req.path.includes('/webhooks/twilio') || req.path === '/voice' || req.path === '/recording') {
    if (Object.keys(req.body || {}).length === 0 && req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
      logger.warn('Twilio webhook body appears empty');
    }
  }
  next();
});

// Request logging and metrics
app.use(metricsMiddleware);
app.use((req, res, next) => {
  logger.info({
    method: req.method,
    url: req.url,
    ip: req.ip,
  }, 'Incoming request');
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    const pool = getPool();
    await pool.query('SELECT 1');
    
    const metrics = getMetrics();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      metrics,
    });
  } catch (error) {
    logger.error({ error: error.message }, 'Health check failed');
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    });
  }
});

// API routes
app.use(routes);

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Initialize database connection
getPool();

// Initialize background job workers (async, non-blocking)
if (config.redis.url) {
  initializeWorkers().catch((error) => {
    logger.warn({ error: error.message }, 'Failed to initialize background workers, continuing without them');
  });
}

scheduleFreePbxSync();
scheduleFreePbxCdrSync();
scheduleFreePbxMetricsSync();
scheduleFreePbxRetention();
scheduleFreePbxVoicemailJobs();
scheduleSystemMetricsHistorySampling();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  stopSystemMetricsHistorySampling();
  await closeQueues();
  await closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  stopSystemMetricsHistorySampling();
  await closeQueues();
  await closePool();
  process.exit(0);
});

// Start server
const port = config.port;

app.listen(port, () => {
  logger.info({ port, nodeEnv: config.nodeEnv }, 'Server started successfully');
  console.log(`\n🚀 Server running on http://localhost:${port}`);
  console.log(`💚 Health check: http://localhost:${port}/health\n`);
});

export default app;

