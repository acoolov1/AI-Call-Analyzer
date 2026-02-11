-- Migration: Add per-user billing settings (custom plan fields)
-- Stores editable plan inputs used by the Billing page.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS billing_settings JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.billing_settings IS 'Per-user billing plan settings (JSON)';

CREATE INDEX IF NOT EXISTS idx_users_billing_settings ON users USING GIN (billing_settings);

