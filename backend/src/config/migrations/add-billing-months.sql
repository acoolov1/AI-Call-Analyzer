-- Migration: Add monthly billing snapshot rows per user
-- Stores base plan snapshot + usage + overage + totals for each calendar month (UTC).

CREATE TABLE IF NOT EXISTS billing_months (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month DATE NOT NULL, -- month start (UTC), e.g. 2026-02-01

  -- Snapshotted plan fields
  base_plan_monthly_charge_usd NUMERIC,
  base_plan_included_audio_hours NUMERIC,

  -- Usage (stored for reporting)
  audio_seconds BIGINT NOT NULL DEFAULT 0,
  audio_minutes NUMERIC NOT NULL DEFAULT 0,

  -- Overage
  overage_seconds BIGINT NOT NULL DEFAULT 0,
  overage_minutes NUMERIC NOT NULL DEFAULT 0,
  overage_charge_usd NUMERIC NOT NULL DEFAULT 0,

  -- Totals
  total_charge_usd NUMERIC NOT NULL DEFAULT 0,

  is_finalized BOOLEAN NOT NULL DEFAULT false,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_billing_months_user_month ON billing_months(user_id, month DESC);

