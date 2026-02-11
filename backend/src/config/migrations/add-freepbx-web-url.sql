-- Add web_url column to freepbx_servers table
ALTER TABLE freepbx_servers 
ADD COLUMN IF NOT EXISTS web_url VARCHAR(500);

COMMENT ON COLUMN freepbx_servers.web_url IS 'Web interface URL for FreePBX (e.g., https://pbx.example.com)';

