# Frontend Deployment Guide

## Vercel Deployment

### Prerequisites

- Vercel account
- GitHub repository connected

### Steps

1. Import your repository in Vercel
2. Set the following environment variables:
   - `NEXT_PUBLIC_API_URL` - Your backend API URL
   - `NEXTAUTH_URL` - Your Vercel deployment URL
   - `NEXTAUTH_SECRET` - Generate with: `openssl rand -base64 32`
   - `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anonymous key
   - `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (server-side only)

3. Deploy!

### Environment Variables

Add these in Vercel dashboard under Project Settings > Environment Variables:

```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
NEXTAUTH_URL=https://yourdomain.vercel.app
NEXTAUTH_SECRET=your-generated-secret
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## Custom Domain

1. Add your domain in Vercel project settings
2. Update DNS records as instructed
3. Update `NEXTAUTH_URL` to your custom domain
4. Redeploy

## Local Development

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local`
3. Fill in environment variables
4. Run: `npm run dev`

## Build

```bash
npm run build
npm start
```

---

## VPS Deployment (PM2 + Nginx) (Production for `app.komilio.com`)

If you are deploying the frontend on the VPS (not Vercel), the **#1 rule** is:

- **Always run PM2 under the `deployer` user. Do not run `pm2` as `root`.**

If you run PM2 as root even once, you can end up with **two PM2 daemons** (root + deployer) and restart the wrong one, making it look like “rebuild did nothing”.

### Rebuild + Restart (safe)

#### Fast path (most deploys)
Use this when you **did not change** `package.json` / `package-lock.json` in `frontend/`.

```bash
# Build (runs as deployer; no need to cd)
sudo -u deployer -H npm --prefix /home/deployer/AI-Call-Analyzer/frontend run build

# Restart the running frontend
sudo -u deployer -H pm2 restart ai-call-frontend
```

#### Full path (when dependencies changed)
Use this when you **did change** `package.json` / `package-lock.json` in `frontend/`.

```bash
cd /home/deployer/AI-Call-Analyzer/frontend
sudo -u deployer -H npm ci
sudo -u deployer -H npm run build

sudo -u deployer -H pm2 restart ai-call-frontend
```

> Note: Avoid long chained one-liners. If a step looks “frozen”, it’s often just quiet while Next.js is
> type-checking / generating pages. Keeping commands split makes it obvious which step is running.

### Also restart backend (recommended when features include new API routes)

```bash
sudo -u deployer -H pm2 restart ai-call-backend
```

### Sanity checks (prevents the “wrong PM2” problem)

```bash
# Must show ai-call-frontend / ai-call-backend as deployer-owned
sudo -u deployer -H pm2 status

# Root PM2 should be empty (or not running)
sudo pm2 status
```

### Verify the new frontend build is being served

```bash
# Shows the chunk filename served for the Extensions page.
curl -sS http://localhost:3001/settings/freepbx/extensions | grep -o \"page-[a-f0-9]\\{16\\}\\.js\" | head -n 1
```

