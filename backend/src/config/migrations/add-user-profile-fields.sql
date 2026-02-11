-- Add user profile + consent fields to users table
-- Used for beta onboarding (contact + company info) and basic compliance audit trail

ALTER TABLE users
ADD COLUMN IF NOT EXISTS full_name TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS company_name TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS address_line1 TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS address_line2 TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS city TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS state TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS postal_code TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS country TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS tos_version TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS privacy_version TEXT;

COMMENT ON COLUMN users.full_name IS 'User full name collected during signup';
COMMENT ON COLUMN users.company_name IS 'Company name collected during signup';
COMMENT ON COLUMN users.phone IS 'Primary contact phone collected during signup';
COMMENT ON COLUMN users.address_line1 IS 'Street address line 1 collected during signup';
COMMENT ON COLUMN users.address_line2 IS 'Street address line 2 collected during signup';
COMMENT ON COLUMN users.city IS 'City collected during signup';
COMMENT ON COLUMN users.state IS 'State/region collected during signup';
COMMENT ON COLUMN users.postal_code IS 'Postal/ZIP code collected during signup';
COMMENT ON COLUMN users.country IS 'Country collected during signup';
COMMENT ON COLUMN users.tos_accepted_at IS 'Timestamp when user accepted Terms of Service';
COMMENT ON COLUMN users.privacy_accepted_at IS 'Timestamp when user accepted Privacy Policy';
COMMENT ON COLUMN users.tos_version IS 'Version/identifier of Terms accepted';
COMMENT ON COLUMN users.privacy_version IS 'Version/identifier of Privacy Policy accepted';

