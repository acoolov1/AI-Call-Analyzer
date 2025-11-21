import { logger } from '../utils/logger.js';

// Simple in-memory metrics (replace with proper metrics service in production)
const metrics = {
  requests: 0,
  errors: 0,
  responseTimes: [],
};

export function metricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    metrics.requests++;
    metrics.responseTimes.push(duration);

    // Keep only last 1000 response times
    if (metrics.responseTimes.length > 1000) {
      metrics.responseTimes.shift();
    }

    if (res.statusCode >= 400) {
      metrics.errors++;
    }

    // Log slow requests
    if (duration > 1000) {
      logger.warn({
        method: req.method,
        url: req.url,
        duration,
        statusCode: res.statusCode,
      }, 'Slow request detected');
    }
  });

  next();
}

export function getMetrics() {
  const avgResponseTime = metrics.responseTimes.length > 0
    ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
    : 0;

  return {
    requests: metrics.requests,
    errors: metrics.errors,
    averageResponseTime: Math.round(avgResponseTime),
    errorRate: metrics.requests > 0
      ? (metrics.errors / metrics.requests * 100).toFixed(2)
      : 0,
  };
}

export function resetMetrics() {
  metrics.requests = 0;
  metrics.errors = 0;
  metrics.responseTimes = [];
}

