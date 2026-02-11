import dotenv from 'dotenv';

dotenv.config();

const requiredEnvVars = [
  'DATABASE_URL',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'OPENAI_API_KEY',
];

const optionalEnvVars = {
  PORT: 3000,
  NODE_ENV: 'development',
  REDIS_URL: 'redis://localhost:6379',
  FRONTEND_URL: 'http://localhost:3001',
  FREEPBX_CRED_SECRET: null,
  FREEPBX_ENABLED: 'false',
  FREEPBX_PORT: '8089',
  FREEPBX_TLS: 'true',
  FREEPBX_TLS_REJECT_UNAUTHORIZED: 'false',
  FREEPBX_SYNC_INTERVAL_MINUTES: '5',
};

// Validate required environment variables
function validateEnv() {
  const missing = requiredEnvVars.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file.'
    );
  }
}

// Set defaults for optional variables
function setDefaults() {
  Object.entries(optionalEnvVars).forEach(([key, defaultValue]) => {
    if (!process.env[key]) {
      process.env[key] = String(defaultValue);
    }
  });
}

// Initialize
setDefaults();

if (process.env.NODE_ENV !== 'test') {
  validateEnv();
}

export const config = {
  port: parseInt(process.env.PORT, 10),
  nodeEnv: process.env.NODE_ENV,
  database: {
    url: process.env.DATABASE_URL,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    webhookSecret: process.env.TWILIO_WEBHOOK_SECRET,
    businessPhoneNumber: process.env.BUSINESS_PHONE_NUMBER,
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
  },
  cors: {
    frontendUrl: process.env.FRONTEND_URL,
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  freepbx: {
    enabled: process.env.FREEPBX_ENABLED === 'true',
    host: process.env.FREEPBX_HOST,
    port: parseInt(process.env.FREEPBX_PORT || '8089', 10),
    username: process.env.FREEPBX_USERNAME,
    password: process.env.FREEPBX_PASSWORD,
    credSecret: process.env.FREEPBX_CRED_SECRET,
    tls: process.env.FREEPBX_TLS !== 'false',
    rejectUnauthorized: process.env.FREEPBX_TLS_REJECT_UNAUTHORIZED !== 'false',
    syncIntervalMinutes: parseInt(process.env.FREEPBX_SYNC_INTERVAL_MINUTES || '10', 10) || 10,
    defaultUserId: process.env.FREEPBX_DEFAULT_USER_ID,
  },
};

