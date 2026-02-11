export const CALL_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const CALL_SOURCE = {
  TWILIO: 'twilio',
  FREEPBX: 'freepbx',
  FREEPBX_CDR: 'freepbx-cdr',
};

export const REDACTION_STATUS = {
  NOT_NEEDED: 'not_needed',
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const SENTIMENT = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  NEUTRAL: 'neutral',
};

export const SUBSCRIPTION_TIER = {
  FREE: 'free',
  PRO: 'pro',
  ENTERPRISE: 'enterprise',
};

export const RATE_LIMITS = {
  API: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // requests per window
  },
  WEBHOOK: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // requests per window
  },
};

