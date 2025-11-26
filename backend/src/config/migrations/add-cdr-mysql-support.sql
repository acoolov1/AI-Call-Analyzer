-- Add MySQL connection fields to users table for FreePBX CDR access
-- These fields extend the freepbx_settings JSONB column

-- Update the comment to reflect new fields
COMMENT ON COLUMN users.freepbx_settings IS 
'FreePBX integration settings including ARI and MySQL CDR access:
{
  "enabled": boolean,
  "host": string,
  "port": number,
  "username": string (ARI username),
  "password": string (ARI password),
  "tls": boolean,
  "rejectUnauthorized": boolean,
  "mysql_host": string (defaults to same as host),
  "mysql_port": number (defaults to 3306),
  "mysql_username": string (for asteriskcdrdb access),
  "mysql_password": string,
  "mysql_database": string (defaults to asteriskcdrdb)
}';

-- Note: No schema changes needed - freepbx_settings is already a JSONB column
-- The new fields will be stored in the existing JSONB structure

