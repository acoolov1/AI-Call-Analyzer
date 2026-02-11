-- Track Whisper transcription API call attempts (to compare with OpenAI dashboard "model requests").
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS whisper_requests INTEGER NOT NULL DEFAULT 0;

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS whisper_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_calls_whisper_requested_at
  ON calls(whisper_requested_at DESC);

