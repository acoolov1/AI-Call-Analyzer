# AI Call Analysis - Prototype

## Features
- Receives calls via Twilio
- **Forwards calls to Connex** (business phone system at +17173815064)
- Records all forwarded calls
- AI-powered transcription using OpenAI Whisper
- Automated call analysis with GPT-4
- Web dashboard for viewing call history and analytics

## Setup
1. Install dependencies: `npm install`
2. Configure `.env` file with:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `OPENAI_API_KEY`
   - `BUSINESS_PHONE_NUMBER=+17173815064` (Connex number)
   - `PORT` (optional, defaults to 3000)
3. Run: `node index.js`

## Endpoints
- `POST /voice` - Handles incoming calls, forwards to Connex, and records
- `POST /recording-complete` - Processes recordings, transcribes, and analyzes
- `POST /dial-complete` - Monitors call forwarding status
- `GET /dashboard` - View call analytics dashboard
- `GET /report` - View detailed call reports and interactions
- `GET /audio/:recordingId` - Stream audio recordings

## Status
🚧 **Prototype** - Currently forwards calls to Connex and records them for analysis.

## How It Works
1. Incoming call hits Twilio number → `/voice` endpoint
2. Call is forwarded to Connex business number via `<Dial>`
3. Call is recorded when Connex answers
4. Recording is processed, transcribed, and analyzed
5. Results are stored and viewable in the web dashboard

