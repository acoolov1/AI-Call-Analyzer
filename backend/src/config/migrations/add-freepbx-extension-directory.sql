CREATE TABLE IF NOT EXISTS freepbx_extension_directory (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  extensions JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_freepbx_extension_directory_updated_at
  ON freepbx_extension_directory(updated_at DESC);

