-- Migration: Add OpenAI settings support to users table
-- This allows users to configure their own OpenAI API credentials and model preferences

-- Add openai_settings JSONB column if it doesn't exist
ALTER TABLE users
ADD COLUMN IF NOT EXISTS openai_settings JSONB DEFAULT '{}';

-- The openai_settings JSONB will store:
-- {
--   "enabled": boolean,
--   "api_key": string (encrypted),
--   "whisper_model": string (default: "whisper-1"),
--   "gpt_model": string (default: "gpt-4o-mini")
-- }

