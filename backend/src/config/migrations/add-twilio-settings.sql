-- Add twilio_settings column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS twilio_settings JSONB DEFAULT '{
  "forwardingEnabled": true,
  "forwardPhoneNumber": "",
  "recordingEnabled": true,
  "callTimeout": 30,
  "customGreeting": "",
  "playRecordingBeep": true,
  "maxRecordingLength": 3600,
  "finishOnKey": "#",
  "afterHoursMessage": "",
  "recordingMode": "record-from-answer"
}'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN users.twilio_settings IS 'User Twilio call handling preferences (JSON)';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_users_twilio_settings ON users USING GIN (twilio_settings);

