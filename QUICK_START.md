# Quick Start

Get up and running in 5 minutes.

## Prerequisites

- Node.js 18+
- PostgreSQL (or Supabase account)
- Redis (optional, for background jobs)
- Twilio account
- OpenAI API key

## 1. Install Dependencies ✅

Already done! Both backend and frontend dependencies are installed.

## 2. Create Environment Files

### Backend
```bash
cd backend
copy env.example.txt .env
```

### Frontend
```bash
cd frontend
copy env.example.txt .env.local
```

## 3. Fill in Environment Variables

### Minimum Required for Backend `.env`:
```env
DATABASE_URL=postgresql://user:pass@host:port/db
TWILIO_ACCOUNT_SID=your-sid
TWILIO_AUTH_TOKEN=your-token
OPENAI_API_KEY=your-key
JWT_SECRET=$(openssl rand -base64 32)
FRONTEND_URL=http://localhost:3001
```

### Minimum Required for Frontend `.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3001
NEXTAUTH_SECRET=$(openssl rand -base64 32)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-key
```

## 4. Set Up Database

### Quick Supabase Setup:
1. Create project at supabase.com
2. Run SQL from `backend/src/config/schema.sql` in SQL Editor
3. Copy connection string to `DATABASE_URL`

### Initialize:
```bash
cd backend
npm run setup-db
```

## 5. Start Services

### Terminal 1 - Backend:
```bash
cd backend
npm run dev
```

### Terminal 2 - Frontend:
```bash
cd frontend
npm run dev
```

## 6. Access Application

- Frontend: http://localhost:3001
- Backend API: http://localhost:3000
- Health Check: http://localhost:3000/health

## That's It! 🎉

Your application should now be running. See `SETUP_GUIDE.md` for detailed configuration.

