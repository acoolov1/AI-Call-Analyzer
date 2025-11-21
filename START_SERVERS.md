# 🚀 How to Start Your Application

## Quick Start

### Step 1: Start Backend (Terminal 1)

```bash
cd backend
npm run dev
```

Wait until you see:
- ✅ "Database connected successfully"
- ✅ "Server started" on port 3000

### Step 2: Start Frontend (Terminal 2 - New Terminal)

```bash
cd frontend
npm run dev
```

Wait until you see:
- ✅ Next.js ready on http://localhost:3001

### Step 3: Open in Browser

- **Frontend**: http://localhost:3001
- **Backend Health**: http://localhost:3000/health

## What You Should See

### Backend Terminal:
```
[INFO] Database connected successfully
[INFO] Server started on port 3000
[INFO] Background job workers initialized
```

### Frontend Terminal:
```
▲ Next.js 14.x.x
- Local:        http://localhost:3001
- ready started server on 0.0.0.0:3001
```

## Troubleshooting

### Backend won't start?
- Check that database connection is working: `npm run test-connections`
- Make sure port 3000 is not in use

### Frontend won't start?
- Check that backend is running first
- Make sure port 3001 is not in use
- Verify `.env.local` file exists and has correct values

### Redis errors?
- These are normal if Redis isn't installed
- The app will work, just background jobs won't run
- Install Redis if you need background job processing

## Stopping Servers

Press `Ctrl+C` in each terminal to stop the servers.

