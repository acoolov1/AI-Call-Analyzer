-- Mark when user has "listened" to a voicemail in the app (e.g. on play start).
ALTER TABLE voicemail_messages
  ADD COLUMN IF NOT EXISTS listened_at TIMESTAMPTZ;
