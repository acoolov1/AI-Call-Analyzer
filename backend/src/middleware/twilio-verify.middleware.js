import { createHmac } from 'crypto';
import { ForbiddenError } from '../utils/errors.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Verify Twilio webhook signature
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyTwilioSignature(req, res, next) {
  // Skip verification if no secret is configured (development)
  if (!config.twilio.webhookSecret) {
    console.log('⚠️  Twilio webhook secret not configured, skipping verification (development mode)');
    logger.warn('Twilio webhook secret not configured, skipping verification');
    return next();
  }

  const signature = req.headers['x-twilio-signature'];
  if (!signature) {
    logger.warn('Missing Twilio signature header - allowing in development');
    // In development, allow without signature if secret is not set
    if (!config.twilio.webhookSecret) {
      return next();
    }
    return next(new ForbiddenError('Missing Twilio signature'));
  }

  // Get the full URL of the request
  // Important: Use the URL that Twilio actually called (from x-forwarded-* headers)
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers['host'] || req.get('host');
  
  // Use originalUrl to preserve the exact path Twilio called
  // For ngrok, this should be the full path including /voice
  const url = `${protocol}://${host}${req.originalUrl || req.url}`;

  // Create the signature
  const data = Object.keys(req.body)
    .sort()
    .reduce((acc, key) => {
      acc += key + req.body[key];
      return acc;
    }, url);

  const computedSignature = createHmac('sha1', config.twilio.webhookSecret)
    .update(data, 'utf-8')
    .digest('base64');

  // Compare signatures
  if (signature !== computedSignature) {
    // In development, log but allow (for easier debugging with ngrok)
    if (process.env.NODE_ENV === 'development') {
      console.warn('\n⚠️  Twilio signature verification failed (but allowing in development)');
      console.warn('Provided:', signature);
      console.warn('Computed:', computedSignature);
      console.warn('URL used:', url);
      console.warn('Body keys:', Object.keys(req.body).sort().join(', '));
      console.warn('');
      
      logger.warn({
        provided: signature,
        computed: computedSignature,
        url,
        bodyKeys: Object.keys(req.body).sort(),
      }, 'Twilio signature verification failed (allowing in development)');
      
      // Allow in development mode for easier debugging
      return next();
    }
    
    logger.warn({
      provided: signature,
      computed: computedSignature,
      url,
    }, 'Twilio signature verification failed');
    return next(new ForbiddenError('Invalid Twilio signature'));
  }

  next();
}

