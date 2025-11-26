-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  hashed_password VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  subscription_tier VARCHAR(50) DEFAULT 'free',
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  timezone VARCHAR(100) DEFAULT 'UTC',
  freepbx_settings JSONB
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Calls Table
CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_sid VARCHAR(255) UNIQUE,
  recording_sid VARCHAR(255),
  caller_number VARCHAR(50),
  caller_name VARCHAR(255),
  transcript TEXT,
  analysis TEXT,
  recording_url TEXT,
  recording_path TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  duration INTEGER,
  source VARCHAR(50) DEFAULT 'twilio',
  external_id VARCHAR(255),
  external_created_at TIMESTAMPTZ,
  source_metadata JSONB,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_call_sid ON calls(call_sid);
CREATE INDEX IF NOT EXISTS idx_calls_source ON calls(source);
CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_source_external ON calls(source, external_id) WHERE external_id IS NOT NULL;

-- Call Metadata Table
CREATE TABLE IF NOT EXISTS call_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE UNIQUE,
  summary TEXT,
  sentiment VARCHAR(50),
  action_items JSONB,
  urgent_topics TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_metadata_call_id ON call_metadata(call_id);
CREATE INDEX IF NOT EXISTS idx_call_metadata_sentiment ON call_metadata(sentiment);

-- Row-Level Security (for Supabase)
-- Uncomment these if using Supabase

-- ALTER TABLE calls ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE call_metadata ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY "Users can view own calls"
--   ON calls FOR SELECT
--   USING (auth.uid() = user_id);

-- CREATE POLICY "Users can insert own calls"
--   ON calls FOR INSERT
--   WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can update own calls"
--   ON calls FOR UPDATE
--   USING (auth.uid() = user_id);

-- CREATE POLICY "Users can delete own calls"
--   ON calls FOR DELETE
--   USING (auth.uid() = user_id);

-- CREATE POLICY "Users can view own call metadata"
--   ON call_metadata FOR SELECT
--   USING (
--     EXISTS (
--       SELECT 1 FROM calls
--       WHERE calls.id = call_metadata.call_id
--       AND calls.user_id = auth.uid()
--     )
--   );

-- CREATE POLICY "Users can insert own call metadata"
--   ON call_metadata FOR INSERT
--   WITH CHECK (
--     EXISTS (
--       SELECT 1 FROM calls
--       WHERE calls.id = call_metadata.call_id
--       AND calls.user_id = auth.uid()
--     )
--   );

