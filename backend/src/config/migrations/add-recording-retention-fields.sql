-- Add retention-related recording deletion tracking to calls
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS recording_deleted_at TIMESTAMPTZ;

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS recording_deleted_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_calls_recording_deleted_at
  ON calls(recording_deleted_at DESC);

