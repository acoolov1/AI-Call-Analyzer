ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS direction VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_calls_direction ON calls(direction);

