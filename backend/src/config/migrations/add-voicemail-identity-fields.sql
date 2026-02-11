-- Add voicemail identity + last_seen for reconciliation and UI deletes
ALTER TABLE voicemail_messages
  ADD COLUMN IF NOT EXISTS metadata_path TEXT,
  ADD COLUMN IF NOT EXISTS pbx_identity TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Stable unique identity to avoid duplicates when msg_id/folder change (best-effort).
CREATE UNIQUE INDEX IF NOT EXISTS idx_voicemail_messages_user_identity
  ON voicemail_messages(user_id, vm_context, mailbox, pbx_identity)
  WHERE pbx_identity IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_voicemail_messages_user_last_seen
  ON voicemail_messages(user_id, last_seen_at DESC);

