# Backend API

Express.js backend for AI Call Analysis SaaS.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your values

3. Run the server:
   ```bash
   npm run dev  # Development with watch mode
   npm start    # Production
   ```

## Project Structure

```
src/
├── routes/          # API route definitions
├── controllers/     # Request handlers
├── services/        # Business logic
├── models/          # Database models
├── middleware/      # Express middleware
├── utils/           # Utility functions
├── jobs/            # Background job processors
├── config/          # Configuration files
└── server.js        # Entry point
```

## API Endpoints

### Public
- `POST /api/v1/webhooks/twilio/voice` - Twilio voice webhook
- `POST /api/v1/webhooks/twilio/recording` - Twilio recording webhook
- `GET /health` - Health check

### Protected (require authentication)
- `GET /api/v1/calls` - List calls
- `GET /api/v1/calls/:id` - Get call details
- `GET /api/v1/stats` - Dashboard statistics
- `GET /api/v1/audio/:id` - Stream call recording (**supports HTTP Range for seeking/scrubbing**)
- `POST /api/v1/calls/:id/retry` - Retry failed analysis
- `DELETE /api/v1/calls/:id` - Delete call

## Environment Variables

See `.env.example` for required environment variables.

