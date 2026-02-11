# AI Call Analysis

AI-powered call analysis system with Twilio integration, transcription, and sentiment analysis.

## 🏗️ Architecture

This is a **modern full-stack application** with separated frontend and backend:

### Backend (Port 3000)
- **Express.js** REST API
- **PostgreSQL** database (Supabase)
- **OpenAI** API for transcription and analysis
- **Twilio** webhooks for call recording
- **Redis** (optional) for job queuing

**Location:** `/backend`

### Frontend (Port 3001)
- **Next.js 14** with App Router
- **TypeScript** & **React 18**
- **NextAuth.js** for authentication
- **CSS Modules** for styling
- **TanStack Query** for data fetching

**Location:** `/frontend`

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL database (or Supabase account)
- Twilio account with phone number
- OpenAI API key
- *(Optional)* FreePBX/Asterisk instance (tested on FreePBX **16.0.41.1** / Asterisk **16.25.0**)

### Setup

1. **Backend Setup**
   ```bash
   cd backend
   npm install
   cp env.example.txt .env
   # Edit .env with your credentials
   npm run dev  # Starts on port 3000
   ```

2. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   cp env.example.txt .env.local
   # Edit .env.local with your credentials
   npm run dev  # Starts on port 3001
   ```

3. **Easy Start (Windows) - RECOMMENDED ⭐**
   - **First time or after restart:** Double-click `START_ALL_SAFELY.ps1` or `START_ALL_SAFELY.bat`
   - **Backend only (with logs):** Double-click `START_BACKEND_WITH_LOGS.bat`
   - **Check status:** Double-click `CHECK_SERVERS.bat`
   - **Fix issues:** Double-click `RESTART_EVERYTHING.bat`
   
   📖 **See [STARTUP_GUIDE.md](STARTUP_GUIDE.md) for detailed instructions**

4. **Access the Application**
   - Frontend: http://localhost:3001
   - Backend API: http://localhost:3000

---

## 📁 Project Structure

```
ai-call-analysis/
├── backend/                 # Express API server
│   ├── src/
│   │   ├── config/         # Database & environment config
│   │   ├── controllers/    # API route handlers
│   │   ├── middleware/     # Auth, rate limiting, etc.
│   │   ├── models/         # Database models
│   │   ├── routes/         # API & webhook routes
│   │   ├── services/       # Business logic (AI, Twilio)
│   │   ├── utils/          # Helper functions
│   │   └── server.js       # Express app entry point
│   └── package.json
│
├── frontend/               # Next.js app
│   ├── app/
│   │   ├── (auth)/        # Login & signup pages
│   │   ├── (dashboard)/   # Protected dashboard routes
│   │   └── api/           # Next.js API routes
│   ├── components/        # React components
│   ├── hooks/             # Custom React hooks
│   ├── lib/               # Utilities & API client
│   └── types/             # TypeScript definitions
│
├── START_BACKEND.bat      # Quick start backend
├── START_FRONTEND.bat     # Quick start frontend
├── RESTART_EVERYTHING.bat # Kill all & restart guide
└── README.md              # This file
```

---

## 🔧 Environment Variables

### Backend (.env)
```env
# Database (Supabase)
DATABASE_URL=postgresql://...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...

# Twilio
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...

# OpenAI
OPENAI_API_KEY=...

# Server
PORT=3000
NODE_ENV=development

# FreePBX MySQL CDR (optional)
FREEPBX_MYSQL_HOST=
FREEPBX_MYSQL_PORT=3306
FREEPBX_MYSQL_USERNAME=
FREEPBX_MYSQL_PASSWORD=
FREEPBX_MYSQL_DATABASE=asteriskcdrdb

# FreePBX SSH (for recording download & redaction - optional)
FREEPBX_SSH_HOST=
FREEPBX_SSH_PORT=22
FREEPBX_SSH_USERNAME=
FREEPBX_SSH_PASSWORD=
FREEPBX_SSH_PRIVATE_KEY=
FREEPBX_SSH_BASE_PATH=/var/spool/asterisk/monitor
```

### Frontend (.env.local)
```env
# API
NEXT_PUBLIC_API_URL=http://localhost:3000

# NextAuth
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=...

# Supabase (for auth)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## 📋 Key Features

- ✅ **Real-time call transcription** via OpenAI Whisper
- ✅ **AI-powered analysis** (sentiment, topics, action items)
- ✅ **Sensitive-data redaction (PCI + PII/PHI)** - Detects and redacts/mutes card data and common PII (DOB, SSN, email, address, password/PIN)
- ✅ **Booking field extraction** - Analysis includes a Booking status shown in Call History
- ✅ **Secure authentication** with NextAuth.js
- ✅ **Audio playback** of recorded calls
- ✅ **Searchable call history**
- ✅ **Dashboard with analytics**
- ✅ **Responsive design** (mobile-friendly)
- ✅ **FreePBX CDR ingestion** alongside Twilio (scheduled + manual sync button)
- ✅ **Unanswered FreePBX calls** (NO ANSWER/BUSY/FAILED/etc.) included in Call History (no audio/transcript processing; shown with a red label)
- ✅ **Persistent call direction** (Inbound/Outbound) for FreePBX CDR calls + server-side Call History filters (Direction/Booking/Sentiment/No Answer)

---

## 🛠️ Development

### Backend Commands
```bash
cd backend
npm run dev          # Start dev server with hot reload
npm start            # Start production server
npm run setup-db     # Initialize database schema
```

### Frontend Commands
```bash
cd frontend
npm run dev          # Start Next.js dev server
npm run build        # Build for production
npm start            # Start production server
npm run lint         # Run ESLint
```

---

## 🐛 Troubleshooting

### After Computer Restart: App Not Working / CORS Errors
**SOLUTION:** Use the safe startup script to prevent port conflicts
1. Double-click `RESTART_EVERYTHING.bat` to clean up
2. Double-click `START_ALL_SAFELY.ps1` or `START_ALL_SAFELY.bat`
3. Run `CHECK_SERVERS.bat` to verify both servers are running correctly

See [STARTUP_GUIDE.md](STARTUP_GUIDE.md) for detailed instructions.

### Port Already in Use
Run `RESTART_EVERYTHING.bat` to kill all Node processes and free up ports.

### Database Connection Issues
- Verify `DATABASE_URL` in backend `.env`
- Check Supabase project is active
- Run `npm run setup-db` to create tables

### Frontend Can't Connect to Backend
- Ensure backend is running on port 3000
- Check `NEXT_PUBLIC_API_URL` in frontend `.env.local`
- Verify CORS is configured in backend
- Run `CHECK_SERVERS.bat` to verify servers are on correct ports

### Twilio Webhooks Not Working
- Use ngrok to expose local server: `ngrok http 3000`
- Update Twilio webhook URL to ngrok URL
- Check Twilio signature verification is enabled

---

## 📚 API Documentation

### Authentication
All API routes (except webhooks) require authentication via NextAuth session.

### Main Endpoints
- `GET /api/calls` - List all calls
- `GET /api/calls/:id` - Get call details
- `GET /api/stats` - Get analytics stats
- `POST /webhooks/recording-status` - Twilio webhook
- `GET /api/v1/audio/:id` - Stream call recording (**supports HTTP Range for reliable seeking/scrubbing**)
- `GET /api/audio/:id` - Frontend proxy for audio streaming (forwards Range + auth)
- `GET /api/v1/integrations/freepbx/cdr/status` - Current FreePBX CDR sync state
- `POST /api/v1/integrations/freepbx/cdr/test` - Test MySQL connection
- `POST /api/v1/integrations/freepbx/cdr/sync` - Trigger manual FreePBX CDR sync
- `GET /api/v1/cdr-calls` - List FreePBX CDR calls (supports `startDate`, `endDate`, `direction`, `booking`, `sentiment`, `notAnswered`, plus pagination)
- `GET /api/v1/cdr-calls/ids` - List matching call IDs for bulk actions (same filters as `/api/v1/cdr-calls`)
- `POST /api/v1/integrations/freepbx/ssh/test` - Test SSH connection
- `GET /api/v1/integrations/freepbx/recordings-stats` - Recordings folder stats (file count + size); queried on FreePBX settings page load

### Audio Player (Call History)
- **Duration display**: shown immediately on row expand using CDR-derived duration (`calls.duration` / `billsec`) — **no extra metadata request**.
- **Playback + scrubbing**: uses the audio stream endpoints above with **HTTP Range** support so seeking is reliable, even for long recordings.

See `/backend/src/routes/` for full API specification.

---

## 🔁 FreePBX Integration Workflow

1. **Backend configuration**
   - Set `FREEPBX_*` variables in `backend/.env` *or*
   - Use the frontend UI (Settings ▸ FreePBX) to store credentials per user.
2. **Configure MySQL CDR access**
   - Create a dedicated MySQL user with read access to `asteriskcdrdb`.
   - Grant access from your application server's IP address.
3. **Configure SSH access**
   - Set up SSH credentials for recording download and sensitive-data redaction uploads (PCI + PII/PHI).
   - See [PCI_REDACTION_GUIDE.md](PCI_REDACTION_GUIDE.md) for complete setup instructions (covers broader sensitive-data redaction).
4. **Connect via UI**
   - Navigate to **Settings ▸ FreePBX Integration**, fill in MySQL and SSH credentials, then click **Save settings**.
   - Use **Test MySQL** and **Test SSH** to verify credentials are valid.
5. **Ingest recordings**
   - Automatic background sync runs every 10 minutes (configurable).
   - On the **Call History** page click **Refresh** to trigger a manual fetch.
   - FreePBX calls appear with proper caller ID, transcription, and analysis.
6. **Manual verification**
   - Record a call in FreePBX, press **Refresh**, and verify the call appears with audio and transcription.

---

## 🚢 Deployment

### Backend
- Deploy to Railway, Render, or any Node.js host
- Set environment variables
- Ensure database is accessible
- Configure Twilio webhooks to production URL

### Frontend
- Deploy to Vercel (recommended for Next.js)
- Set environment variables in Vercel dashboard
- Update `NEXTAUTH_URL` to production domain

### VPS (PM2) Rebuild / Restart (Production)
If you're running both backend + frontend on a VPS with PM2 (see `ecosystem.config.js`), code changes are not live until you **rebuild the frontend** and **restart the PM2 process**.

```bash
# Reinstall deps (use lockfiles)
cd /home/deployer/AI-Call-Analyzer/backend
sudo -u deployer -H npm ci
cd /home/deployer/AI-Call-Analyzer/frontend
sudo -u deployer -H npm ci

# Rebuild frontend (required for UI/CSS changes)
cd /home/deployer/AI-Call-Analyzer/frontend
sudo -u deployer -H npm run build

# Restart PM2 processes (PM2 runs under the deployer user)
sudo -u deployer -H pm2 restart ai-call-backend
sudo -u deployer -H pm2 restart ai-call-frontend
```

If the UI still looks unchanged after deploy, do a hard refresh (or use Incognito) to bypass cached assets.

**Sanity check (prevents restarting the wrong PM2 daemon):**

```bash
sudo -u deployer -H pm2 status
sudo pm2 status  # should be empty (or not running)
```

**Verify the new frontend build is being served (example: Extensions page chunk):**

```bash
curl -sS http://localhost:3001/settings/freepbx/extensions | grep -o "page-[a-f0-9]\\{16\\}\\.js" | head -n 1
```

---

## 📄 License

ISC

---

## 🤝 Contributing

This is a private project. For issues or questions, contact the repository owner.
