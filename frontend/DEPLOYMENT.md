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

