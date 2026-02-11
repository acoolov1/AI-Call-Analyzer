ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS redaction_status VARCHAR(50) DEFAULT 'not_needed',
  ADD COLUMN IF NOT EXISTS redacted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS redacted_segments JSONB,
  ADD COLUMN IF NOT EXISTS redacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_backup_path TEXT;

CREATE INDEX IF NOT EXISTS idx_calls_redaction_status ON calls(redaction_status);

