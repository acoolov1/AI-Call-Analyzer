import express from 'express';
import { TwilioController } from '../controllers/twilio.controller.js';
import { verifyTwilioSignature } from '../middleware/twilio-verify.middleware.js';
import { webhookRateLimiter } from '../middleware/rate-limit.middleware.js';

const router = express.Router();

// Twilio webhooks
router.post(
  '/twilio/voice',
  webhookRateLimiter,
  verifyTwilioSignature,
  TwilioController.handleVoiceWebhook
);

router.post(
  '/twilio/recording',
  webhookRateLimiter,
  verifyTwilioSignature,
  TwilioController.handleRecordingWebhook
);

router.post(
  '/twilio/dial-complete',
  webhookRateLimiter,
  verifyTwilioSignature,
  TwilioController.handleDialComplete
);

export default router;

