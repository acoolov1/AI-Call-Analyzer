-- Migration: Add OpenAI usage fields to calls table
-- Stores model + token usage per analyzed call (persists across restarts).

ALTER TABLE calls
ADD COLUMN IF NOT EXISTS gpt_model TEXT;

ALTER TABLE calls
ADD COLUMN IF NOT EXISTS gpt_input_tokens INTEGER;

ALTER TABLE calls
ADD COLUMN IF NOT EXISTS gpt_output_tokens INTEGER;

ALTER TABLE calls
ADD COLUMN IF NOT EXISTS gpt_total_tokens INTEGER;

