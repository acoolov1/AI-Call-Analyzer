import express from 'express';
import apiRoutes from './api.routes.js';
import webhookRoutes from './webhooks.routes.js';
import adminRoutes from './admin.routes.js';
import { TwilioController } from '../controllers/twilio.controller.js';
import { verifyTwilioSignature } from '../middleware/twilio-verify.middleware.js';
import { webhookRateLimiter } from '../middleware/rate-limit.middleware.js';

const router = express.Router();

// IMPORTANT: Webhook routes must come BEFORE API routes
// Webhooks use Twilio signature verification, NOT authentication tokens
// Webhook routes (full path) - mount FIRST to avoid authentication middleware
router.use('/api/v1/webhooks', webhookRoutes);

// Admin routes (require authentication + admin role)
router.use('/api/v1/admin', adminRoutes);

// API v1 routes (require authentication)
router.use('/api/v1', apiRoutes);

// Legacy/alternative webhook routes (for backwards compatibility)
// Some Twilio setups might use /voice instead of /api/v1/webhooks/twilio/voice
router.post(
  '/voice',
  webhookRateLimiter,
  verifyTwilioSignature,
  TwilioController.handleVoiceWebhook
);

// Also add /recording route for recording webhook (Twilio might use this)
router.post(
  '/recording',
  webhookRateLimiter,
  verifyTwilioSignature,
  TwilioController.handleRecordingWebhook
);

export default router;

