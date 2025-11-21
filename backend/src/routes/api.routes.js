import express from 'express';
import { CallsController } from '../controllers/calls.controller.js';
import { StatsController } from '../controllers/stats.controller.js';
import { UserController } from '../controllers/user.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { apiRateLimiter } from '../middleware/rate-limit.middleware.js';

const router = express.Router();

// Skip authentication for webhook routes (they use Twilio signature verification)
router.use((req, res, next) => {
  // If this is a webhook route, skip authentication
  if (req.path.startsWith('/webhooks/')) {
    return next();
  }
  // Otherwise, require authentication
  authenticate(req, res, next);
});

router.use(apiRateLimiter);

// Calls routes
router.get('/calls', CallsController.listCalls);
router.get('/calls/:id', CallsController.getCall);
router.delete('/calls/:id', CallsController.deleteCall);
router.post('/calls/:id/retry', CallsController.retryCall);

// Stats route
router.get('/stats', StatsController.getStats);

// User routes
router.get('/user', UserController.getCurrentUser);
router.patch('/user/preferences', UserController.updatePreferences);

// Audio route (for serving recordings)
router.get('/audio/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { Call } = await import('../models/Call.js');
    const { TwilioService } = await import('../services/twilio.service.js');
    
    const call = await Call.findById(id, req.user.id);
    
    if (!call.recordingUrl) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Stream audio from Twilio
    const audioBuffer = await TwilioService.downloadRecording(call.recordingUrl);
    
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="recording-${id}.wav"`);
    res.send(audioBuffer);
  } catch (error) {
    next(error);
  }
});

export default router;

