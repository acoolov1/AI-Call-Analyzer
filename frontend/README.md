# Frontend - AI Call Analysis

Next.js frontend application for AI Call Analysis SaaS.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in your values

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3001](http://localhost:3001) in your browser

## Environment Variables

- `NEXT_PUBLIC_API_URL` - Backend API URL
- `NEXTAUTH_URL` - Application URL
- `NEXTAUTH_SECRET` - Secret for NextAuth.js
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key

## Project Structure

```
app/
├── (auth)/          # Authentication routes
│   ├── login/
│   └── signup/
├── (dashboard)/     # Protected dashboard routes
│   ├── dashboard/
│   ├── calls/
│   ├── calls/[id]/
│   ├── settings/
│   └── billing/
└── api/             # Next.js API routes (NextAuth)
components/
├── ui/              # shadcn/ui components
└── calls/           # Call-related components
lib/
├── api-client.ts    # API client with axios
├── auth.ts          # NextAuth configuration
└── utils.ts         # Utility functions
hooks/
├── use-calls.ts     # React Query hooks for calls
└── use-auth.ts      # Auth hooks
types/
└── ...              # TypeScript types (shared from /shared)
```

