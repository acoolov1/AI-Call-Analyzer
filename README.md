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

3. **Easy Start (Windows)**
   - Double-click `START_BACKEND.bat` (starts backend)
   - Double-click `START_FRONTEND.bat` (starts frontend)
   - Or use `START_BACKEND_FIRST.bat` for guided startup

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

See `/backend/src/routes/` for full API specification.

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
