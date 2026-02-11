-- ===========================================================
-- Sync Existing Supabase Auth Users to Users Table
-- ===========================================================
-- This script creates records in the 'users' table for any
-- Supabase Auth users that don't already have a record
--
-- HOW TO APPLY:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Create a new query
-- 3. Paste this SQL and run it
-- ===========================================================

-- Insert any auth users that don't exist in the users table
INSERT INTO public.users (id, email, role, subscription_tier, timezone, created_at, updated_at)
SELECT 
  au.id,
  au.email,
  'user' as role,
  'free' as subscription_tier,
  COALESCE(au.raw_user_meta_data->>'timezone', 'UTC') as timezone,
  au.created_at,
  NOW() as updated_at
FROM auth.users au
WHERE NOT EXISTS (
  SELECT 1 FROM public.users u WHERE u.id = au.id
);

-- Show the results
SELECT 
  u.id,
  u.email,
  u.role,
  u.subscription_tier,
  u.created_at
FROM public.users u
ORDER BY u.created_at DESC;

