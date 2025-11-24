ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS recording_path TEXT,
  ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'twilio',
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS external_created_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS source_metadata JSONB,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_calls_source ON calls(source);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_source_external
  ON calls(source, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS freepbx_settings JSONB;

