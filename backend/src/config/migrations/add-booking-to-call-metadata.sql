ALTER TABLE call_metadata
  ADD COLUMN IF NOT EXISTS booking VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_call_metadata_booking ON call_metadata(booking);

