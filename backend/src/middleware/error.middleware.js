import { logger } from '../utils/logger.js';
import { AppError } from '../utils/errors.js';

export function errorHandler(err, req, res, next) {
  // Always log to console first (before anything else)
  console.error('\n');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('❌ ERROR HANDLER TRIGGERED ❌');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('Time:', new Date().toISOString());
  console.error('URL:', req.method, req.url);
  console.error('Error Message:', err.message);
  console.error('Error Stack:', err.stack);
  console.error('═══════════════════════════════════════════════════════════');
  console.error('\n');
  
  // Log error
  logger.error({
    err,
    url: req.url,
    method: req.method,
    ip: req.ip,
  }, 'Request error');

  // Check if this is a Twilio webhook request
  const isTwilioWebhook = req.path.includes('/webhooks/twilio') || 
                          req.path === '/voice' ||
                          req.headers['x-twilio-signature'] ||
                          req.body.CallSid;

  // For Twilio webhooks, always return TwiML XML, not JSON
  if (isTwilioWebhook) {
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>An error occurred processing your call. Please try again later.</Say>
  <Hangup/>
</Response>`;
    res.type('text/xml');
    return res.status(200).send(errorTwiml);
  }

  // Operational errors: send message to client
  if (err instanceof AppError && err.isOperational) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        ...(err.errors && { errors: err.errors }),
      },
    });
  }

  // Programming or unknown errors: don't leak error details
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  res.status(statusCode).json({
    success: false,
    error: {
      message,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
  });
}

// 404 handler
export function notFoundHandler(req, res, next) {
  // If it's a Twilio webhook request, return TwiML instead of JSON
  const isTwilioWebhook = req.path === '/voice' ||
                          req.path.includes('/webhooks/twilio') ||
                          req.headers['x-twilio-signature'] ||
                          req.body?.CallSid;
  
  if (isTwilioWebhook) {
    logger.warn({ path: req.path, method: req.method }, 'Twilio webhook route not found, returning error TwiML');
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Webhook route not found. Please check your webhook URL configuration.</Say>
  <Hangup/>
</Response>`;
    res.type('text/xml');
    return res.status(200).send(errorTwiml);
  }
  
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

