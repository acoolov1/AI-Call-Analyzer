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
- *(Optional)* FreePBX/Asterisk instance with ARI enabled (tested on FreePBX **16.0.41.1** / Asterisk **16.25.0**)

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

# FreePBX (optional)
FREEPBX_ENABLED=false
FREEPBX_HOST=
FREEPBX_PORT=8089
FREEPBX_USERNAME=
FREEPBX_PASSWORD=
FREEPBX_TLS=true
FREEPBX_TLS_REJECT_UNAUTHORIZED=false
FREEPBX_SYNC_INTERVAL_MINUTES=10
FREEPBX_DEFAULT_USER_ID=<defaults to DEFAULT_USER_ID>
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
- ✅ **Secure authentication** with NextAuth.js
- ✅ **Audio playback** of recorded calls
- ✅ **Searchable call history**
- ✅ **Dashboard with analytics**
- ✅ **Responsive design** (mobile-friendly)
- ✅ **FreePBX ingestion** alongside Twilio (scheduled + manual sync button)

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
- `GET /audio/:id` - Stream call recording
- `GET /api/v1/integrations/freepbx/status` - Current FreePBX sync state + settings
- `POST /api/v1/integrations/freepbx/test` - Test ARI credentials reachability
- `POST /api/v1/integrations/freepbx/sync` - Kick off manual FreePBX recording sync

See `/backend/src/routes/` for full API specification.

---

## 🔁 FreePBX Integration Workflow

1. **Backend configuration**
   - Set `FREEPBX_*` variables in `backend/.env` *or*
   - Use the frontend UI (Settings ▸ FreePBX) to store host/port/credentials per user.
2. **Enable ARI on FreePBX**
   - Create a dedicated user in `ari.conf` (read-only is sufficient for recordings).
   - Ensure the ARI port (8088/8089) is accessible from the backend.
3. **Connect via UI**
   - Navigate to **Settings ▸ FreePBX Integration**, fill in host, port, username, and password, then click **Save settings**.
   - Use **Test Connection** to verify credentials are valid.
4. **Ingest recordings**
   - Automatic background sync runs every `FREEPBX_SYNC_INTERVAL_MINUTES`.
   - On the **Interactions** page click **Sync FreePBX** to trigger a manual fetch.
   - FreePBX calls show the `FreePBX` badge in the caller column and can be expanded to listen/transcribe just like Twilio entries.
5. **Manual verification**
   - Record a call in FreePBX, press **Sync FreePBX**, and verify the call appears with audio and transcription.
   - Query `/api/v1/integrations/freepbx/status` to inspect last-run metadata if debugging.

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

---

## 📄 License

ISC

---

## 🤝 Contributing

This is a private project. For issues or questions, contact the repository owner.
