# Deployment Guide

## Prerequisites

- Node.js 18+ installed on VPS
- PostgreSQL database (Supabase recommended)
- Redis server (for background jobs)
- PM2 installed globally: `npm install -g pm2`
- Domain name with SSL certificate (Let's Encrypt recommended)

## Environment Setup

1. Clone the repository on your VPS
2. Navigate to the backend directory
3. Install dependencies: `npm install`
4. Copy `.env.example` to `.env` and fill in all values
5. Set up the database schema:
   ```bash
   node src/scripts/setup-database.js
   ```
6. (Optional) Migrate existing data:
   ```bash
   node src/scripts/migrate-data.js
   ```

## Database Setup

### Using Supabase

1. Create a new Supabase project
2. Run the SQL schema from `src/config/schema.sql` in the Supabase SQL editor
3. Enable Row-Level Security policies (uncomment in schema.sql)
4. Get your connection string from Supabase dashboard
5. Add to `.env` as `DATABASE_URL`

### Using PostgreSQL Directly

1. Install PostgreSQL on your VPS
2. Create database: `createdb ai_call_analysis`
3. Run schema: `psql ai_call_analysis < src/config/schema.sql`
4. Add connection string to `.env`

## Redis Setup

1. Install Redis: `sudo apt-get install redis-server` (Ubuntu/Debian)
2. Start Redis: `sudo systemctl start redis`
3. Enable on boot: `sudo systemctl enable redis`
4. Add Redis URL to `.env`: `REDIS_URL=redis://localhost:6379`

## PM2 Configuration

1. Start the application:
   ```bash
   pm2 start ecosystem.config.js --env production
   ```

2. Save PM2 configuration:
   ```bash
   pm2 save
   ```

3. Set up PM2 to start on boot:
   ```bash
   pm2 startup
   ```

4. View logs:
   ```bash
   pm2 logs ai-call-analysis-api
   ```

5. Monitor:
   ```bash
   pm2 monit
   ```

## Nginx Configuration (Reverse Proxy)

Example Nginx configuration:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then set up SSL with Let's Encrypt:
```bash
sudo certbot --nginx -d api.yourdomain.com
```

## Environment Variables

Required environment variables in `.env`:

```env
# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://user:password@host:port/database

# Twilio
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_WEBHOOK_SECRET=your-webhook-secret
BUSINESS_PHONE_NUMBER=+1234567890

# OpenAI
OPENAI_API_KEY=your-openai-key

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secure-random-secret

# CORS
FRONTEND_URL=https://yourdomain.com
```

## Monitoring

- Health check: `GET https://api.yourdomain.com/health`
- PM2 monitoring: `pm2 monit`
- Logs: `pm2 logs`
- Metrics endpoint: Included in health check

## Updates

1. Pull latest code: `git pull`
2. Install dependencies: `npm install`
3. Run migrations if needed
4. Restart: `pm2 restart ai-call-analysis-api`

## Troubleshooting

- Check logs: `pm2 logs ai-call-analysis-api`
- Check database connection: `node -e "require('./src/config/database.js').getPool().query('SELECT 1')"`
- Check Redis: `redis-cli ping`
- Restart services: `pm2 restart all`

