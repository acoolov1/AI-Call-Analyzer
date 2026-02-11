-- Persist lightweight system metrics snapshots for history charts.
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

