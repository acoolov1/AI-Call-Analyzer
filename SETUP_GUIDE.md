# Setup Guide

Follow these steps to get your application running.

## Step 1: Install Dependencies ✅

Dependencies have been installed for both backend and frontend.

## Step 2: Set Up Environment Variables

### Backend

1. Copy the example file:
   ```bash
   cd backend
   copy env.example.txt .env
   ```

2. Edit `.env` and fill in:
   - **DATABASE_URL**: Your PostgreSQL connection string (from Supabase)
   - **TWILIO_ACCOUNT_SID** and **TWILIO_AUTH_TOKEN**: From your Twilio dashboard
   - **OPENAI_API_KEY**: From OpenAI
   - **REDIS_URL**: Redis connection (default: `redis://localhost:6379`)
   - **JWT_SECRET**: Generate with: `openssl rand -base64 32`
   - **FRONTEND_URL**: Your frontend URL (e.g., `http://localhost:3001`)

### Frontend

1. Copy the example file:
   ```bash
   cd frontend
   copy env.example.txt .env.local
   ```

2. Edit `.env.local` and fill in:
   - **NEXT_PUBLIC_API_URL**: Your backend URL (e.g., `http://localhost:3000`)
   - **NEXTAUTH_URL**: Your frontend URL (e.g., `http://localhost:3001`)
   - **NEXTAUTH_SECRET**: Generate with: `openssl rand -base64 32`
   - **NEXT_PUBLIC_SUPABASE_URL** and **NEXT_PUBLIC_SUPABASE_ANON_KEY**: From Supabase
   - **SUPABASE_SERVICE_ROLE_KEY**: From Supabase (server-side only)

## Step 3: Set Up Database

### Option A: Using Supabase (Recommended)

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to be ready
3. Go to SQL Editor in Supabase dashboard
4. Copy the contents of `backend/src/config/schema.sql`
5. Paste and run it in the SQL Editor
6. Uncomment the Row-Level Security policies if you want them enabled
7. Get your connection string from Settings > Database
8. Update `DATABASE_URL` in backend `.env`

### Option B: Using Local PostgreSQL

1. Install PostgreSQL
2. Create database: `createdb ai_call_analysis`
3. Run schema:
   ```bash
   psql ai_call_analysis < backend/src/config/schema.sql
   ```
4. Update `DATABASE_URL` in backend `.env`

### Initialize Database

After setting up the database, run:

```bash
cd backend
npm run setup-db
```

## Step 4: Set Up Redis (Optional but Recommended)

Redis is needed for background job processing. Without it, jobs will fail but the app will still work.

### Windows
Download and install from: https://redis.io/download

### Linux/Mac
```bash
# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis

# macOS
brew install redis
brew services start redis
```

## Step 5: Migrate Existing Data (Optional)

If you have existing data in `calls-history.json`:

```bash
cd backend
npm run migrate-data
```

This will:
- Create a default user account
- Import all calls from `calls-history.json`
- Skip duplicates

## Step 6: Configure Supabase Authentication

1. In Supabase dashboard, go to Authentication > Providers
2. Enable Email provider (or other providers you want)
3. Configure email templates if needed
4. Update `backend/src/lib/auth.ts` with your provider settings

## Step 7: Run the Application

### Backend

```bash
cd backend
npm run dev
```

The backend will run on `http://localhost:3000`

### Frontend

In a new terminal:

```bash
cd frontend
npm run dev
```

The frontend will run on `http://localhost:3001`

## Step 8: Test the Setup

1. **Health Check**: Visit `http://localhost:3000/health`
2. **Frontend**: Visit `http://localhost:3001`
3. **Login**: Try logging in (you'll need to create a user first in Supabase)

## Troubleshooting

### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Check if database is accessible
- Ensure schema has been created

### Redis Connection Issues
- Verify Redis is running: `redis-cli ping` (should return PONG)
- Check `REDIS_URL` in `.env`
- Background jobs will fail without Redis, but the app will still work

### Authentication Issues
- Verify Supabase credentials are correct
- Check that authentication providers are enabled in Supabase
- Ensure `NEXTAUTH_SECRET` is set

### Twilio Webhook Issues
- Update Twilio webhook URL to point to your backend
- Verify `TWILIO_WEBHOOK_SECRET` matches Twilio configuration
- Check that `BUSINESS_PHONE_NUMBER` is correct

## Next Steps

Once everything is running locally:

1. **Deploy Backend**: Follow `backend/DEPLOYMENT.md`
2. **Deploy Frontend**: Follow `frontend/DEPLOYMENT.md`
3. **Update Webhooks**: Point Twilio webhooks to your production backend URL

## Quick Start Commands

```bash
# Backend
cd backend
copy env.example.txt .env
# Edit .env with your values
npm run setup-db
npm run dev

# Frontend (in new terminal)
cd frontend
copy env.example.txt .env.local
# Edit .env.local with your values
npm run dev
```

