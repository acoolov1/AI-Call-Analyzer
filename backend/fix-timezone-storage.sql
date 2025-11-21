-- Fix timezone storage in PostgreSQL
-- This ensures all timestamps are stored as proper UTC

-- First, let's check what we're working with
SELECT NOW(), CURRENT_TIMESTAMP, timezone('UTC', NOW());

-- Update the calls table to use TIMESTAMPTZ (timestamp with timezone)
-- This will automatically convert and store as UTC
ALTER TABLE calls 
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
  ALTER COLUMN processed_at TYPE TIMESTAMPTZ USING processed_at AT TIME ZONE 'UTC';

-- Update the users table
ALTER TABLE users
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC';

-- Update the call_metadata table  
ALTER TABLE call_metadata
  ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC';

-- Verify the changes
SELECT 
  table_name,
  column_name, 
  data_type 
FROM information_schema.columns 
WHERE table_name IN ('calls', 'users', 'call_metadata') 
  AND column_name LIKE '%created%'
ORDER BY table_name, column_name;

