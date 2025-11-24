# Quick Start

Get up and running in 5 minutes.

## Prerequisites

- Node.js 18+
- PostgreSQL (or Supabase account)
- Redis (optional, for background jobs)
- Twilio account
- OpenAI API key
- *(Optional)* FreePBX/Asterisk box with ARI enabled (tested on FreePBX 16.0.41.1 / Asterisk 16.25.0)

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

# FreePBX (optional)
FREEPBX_ENABLED=false
FREEPBX_HOST=
FREEPBX_PORT=8089
FREEPBX_USERNAME=
FREEPBX_PASSWORD=
FREEPBX_TLS=true
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

## 7. Configure FreePBX (Optional)
1. Enable an ARI user inside FreePBX (`/etc/asterisk/ari.conf`).
2. Go to **Settings ▸ FreePBX** inside the dashboard.
3. Enter host, port, username, and password, then click **Save**.
4. Press **Test Connection** to confirm reachability.
5. Use the **Sync FreePBX** button on the **Interactions** page to pull recordings immediately.

## That's It! 🎉

Your application should now be running. See `SETUP_GUIDE.md` for detailed configuration.

