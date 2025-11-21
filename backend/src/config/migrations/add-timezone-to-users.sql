-- Add timezone column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'UTC';

-- Add comment for documentation
COMMENT ON COLUMN users.timezone IS 'User preferred timezone (IANA timezone format, e.g., America/New_York)';

