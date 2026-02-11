-- ===========================================================
-- Supabase Database Trigger: Auto-create user records
-- ===========================================================
-- This trigger automatically creates a record in the 'users' table
-- when a new user signs up via Supabase Auth
--
-- HOW TO APPLY:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Create a new query
-- 3. Paste this entire SQL and run it
-- ===========================================================

-- Function to handle new user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  default_prompt TEXT := 'You are an AI call analyst. Using the transcript below, generate a structured report.

TRANSCRIPT:
"${transcript}"

IMPORTANT: Format your response EXACTLY as follows, with each section on a new line starting with the number:

1. **Full Transcript**
[Print the full transcript text exactly as provided. Print it as a dialog with each participant on a new line.]

2. **Summary**
[2-3 sentence summary of the conversation]

3. **Action Items**
[Bulleted list of short action items, one per line starting with - ]

4. **Sentiment**
[One word: positive, negative, or neutral]

5. **Urgent Topics**
[List any urgent topics, or "None" if there are none]

6. **Booking**
[If this call was regarding a booking of a medical appointment, scheduling service, or booking a hotel room, label this value as "Booked" or "Not Booked". If not booked, in the summary write one sentence reason why it was not booked, update sentiment and urgent topics accordingly. If this call was not regarding any type of booking, leave this value empty.]

Make sure each section starts with its number (2., 3., 4., 5., 6.) on a new line and is clearly separated.';
BEGIN
  INSERT INTO public.users (
    id,
    email,
    role,
    subscription_tier,
    timezone,
    full_name,
    company_name,
    phone,
    address_line1,
    address_line2,
    city,
    state,
    postal_code,
    country,
    tos_accepted_at,
    privacy_accepted_at,
    tos_version,
    privacy_version,
    can_use_app,
    can_use_freepbx_manager,
    openai_settings,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    'user',
    'free',
    COALESCE(NEW.raw_user_meta_data->>'timezone', 'UTC'),
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'company_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', ''),
    NULLIF(NEW.raw_user_meta_data->>'address_line1', ''),
    NULLIF(NEW.raw_user_meta_data->>'address_line2', ''),
    NULLIF(NEW.raw_user_meta_data->>'city', ''),
    NULLIF(NEW.raw_user_meta_data->>'state', ''),
    NULLIF(NEW.raw_user_meta_data->>'postal_code', ''),
    NULLIF(NEW.raw_user_meta_data->>'country', ''),
    CASE
      WHEN lower(COALESCE(NEW.raw_user_meta_data->>'tos_accepted', '')) IN ('true', '1', 'yes', 'y') THEN NOW()
      ELSE NULL
    END,
    CASE
      WHEN lower(COALESCE(NEW.raw_user_meta_data->>'privacy_accepted', '')) IN ('true', '1', 'yes', 'y') THEN NOW()
      ELSE NULL
    END,
    NULLIF(NEW.raw_user_meta_data->>'tos_version', ''),
    NULLIF(NEW.raw_user_meta_data->>'privacy_version', ''),
    true,
    false,
    jsonb_build_object(
      'enabled', false,
      'whisper_model', 'whisper-1',
      'gpt_model', 'gpt-4o-mini',
      'analysis_prompt', default_prompt
    ),
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger that fires after a new user is created in auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ===========================================================
-- VERIFICATION
-- ===========================================================
-- After running this, test by signing up a new user
-- Then check: SELECT * FROM users ORDER BY created_at DESC;
-- ===========================================================

