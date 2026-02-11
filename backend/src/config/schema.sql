-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('super_admin', 'admin', 'user')),
  can_use_app BOOLEAN NOT NULL DEFAULT true,
  can_use_freepbx_manager BOOLEAN NOT NULL DEFAULT false,
  hashed_password VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  subscription_tier VARCHAR(50) DEFAULT 'free',
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  timezone VARCHAR(100) DEFAULT 'UTC',
  full_name TEXT,
  company_name TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  tos_accepted_at TIMESTAMPTZ,
  privacy_accepted_at TIMESTAMPTZ,
  tos_version TEXT,
  privacy_version TEXT,
  twilio_settings JSONB,
  openai_settings JSONB,
  billing_settings JSONB,
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
  recording_deleted_at TIMESTAMPTZ,
  recording_deleted_reason TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  duration INTEGER,
  whisper_requests INTEGER NOT NULL DEFAULT 0,
  whisper_requested_at TIMESTAMPTZ,
  source VARCHAR(50) DEFAULT 'twilio',
  gpt_model TEXT,
  gpt_input_tokens INTEGER,
  gpt_output_tokens INTEGER,
  gpt_total_tokens INTEGER,
  external_id VARCHAR(255),
  external_created_at TIMESTAMPTZ,
  source_metadata JSONB,
  redaction_status VARCHAR(50) DEFAULT 'not_needed',
  redacted BOOLEAN DEFAULT false,
  redacted_segments JSONB,
  redacted_at TIMESTAMPTZ,
  original_backup_path TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_calls_user_id ON calls(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_redaction_status ON calls(redaction_status);
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
  booking VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_metadata_call_id ON call_metadata(call_id);
CREATE INDEX IF NOT EXISTS idx_call_metadata_sentiment ON call_metadata(sentiment);

-- Voicemail Messages (FreePBX/Asterisk voicemail transcription + analysis)
CREATE TABLE IF NOT EXISTS voicemail_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mailbox VARCHAR(50) NOT NULL,
  vm_context TEXT NOT NULL DEFAULT 'default',
  folder TEXT NOT NULL DEFAULT 'INBOX',
  msg_id VARCHAR(20) NOT NULL,
  received_at TIMESTAMPTZ,
  caller_id TEXT,
  duration_seconds INTEGER,
  recording_path TEXT,
  metadata_path TEXT,
  pbx_identity TEXT,
  last_seen_at TIMESTAMPTZ,
  listened_at TIMESTAMPTZ,
  transcript TEXT,
  analysis TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, vm_context, mailbox, folder, msg_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_voicemail_messages_user_identity
  ON voicemail_messages(user_id, vm_context, mailbox, pbx_identity)
  WHERE pbx_identity IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voicemail_messages_user_received
  ON voicemail_messages(user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_voicemail_messages_user_status
  ON voicemail_messages(user_id, status);

CREATE INDEX IF NOT EXISTS idx_voicemail_messages_user_last_seen
  ON voicemail_messages(user_id, last_seen_at DESC);

-- Billing Months (monthly billing snapshots for reporting)
CREATE TABLE IF NOT EXISTS billing_months (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  base_plan_monthly_charge_usd NUMERIC,
  base_plan_included_audio_hours NUMERIC,
  audio_seconds BIGINT NOT NULL DEFAULT 0,
  audio_minutes NUMERIC NOT NULL DEFAULT 0,
  overage_seconds BIGINT NOT NULL DEFAULT 0,
  overage_minutes NUMERIC NOT NULL DEFAULT 0,
  overage_charge_usd NUMERIC NOT NULL DEFAULT 0,
  total_charge_usd NUMERIC NOT NULL DEFAULT 0,
  is_finalized BOOLEAN NOT NULL DEFAULT false,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_billing_months_user_month ON billing_months(user_id, month DESC);

-- System Metrics Samples (for System Monitor history charts)
CREATE TABLE IF NOT EXISTS system_metrics_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cpu_percent NUMERIC NOT NULL,
  memory_percent NUMERIC NOT NULL,
  disk_percent NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_metrics_samples_recorded_at
  ON system_metrics_samples(recorded_at DESC);

-- FreePBX Servers (for bulk user management)
CREATE TABLE IF NOT EXISTS freepbx_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  root_username VARCHAR(255) NOT NULL DEFAULT 'root',
  root_password_encrypted TEXT,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(host, port)
);

CREATE INDEX IF NOT EXISTS idx_freepbx_servers_host_port ON freepbx_servers(host, port);

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

