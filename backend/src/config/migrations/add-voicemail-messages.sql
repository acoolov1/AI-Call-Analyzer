-- Add voicemail_messages table for FreePBX voicemail transcription/analysis
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
  transcript TEXT,
  analysis TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, vm_context, mailbox, folder, msg_id)
);

CREATE INDEX IF NOT EXISTS idx_voicemail_messages_user_received
  ON voicemail_messages(user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_voicemail_messages_user_status
  ON voicemail_messages(user_id, status);

