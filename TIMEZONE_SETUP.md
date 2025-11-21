# Timezone Feature Setup Guide

This guide will help you set up the timezone feature for displaying call timestamps in the user's preferred timezone.

## What's New

- **Timezone Setting**: Users can now select their preferred timezone in the Settings page
- **Accurate Timestamps**: All call timestamps throughout the application will be displayed in the selected timezone
- **Auto-Detection**: The system can detect the user's browser timezone and offer to use it
- **Global Support**: Includes common timezones from around the world

## Setup Instructions

### Step 1: Run Database Migration

The timezone feature requires adding a new column to the `users` table. Run the migration script:

```bash
cd backend
node src/scripts/add-timezone-migration.js
```

This will add a `timezone` column to the `users` table with a default value of 'UTC'.

### Step 2: Restart Backend Server

After running the migration, restart your backend server to ensure all changes are loaded:

```bash
# If using the batch file
START_BACKEND.bat

# Or manually
cd backend
npm start
```

### Step 3: Restart Frontend Server

Restart the frontend server to load the new timezone features:

```bash
# If using the batch file
START_FRONTEND.bat

# Or manually
cd frontend
npm run dev
```

## How to Use

### For Users

1. **Navigate to Settings**: Click on "Settings" in the sidebar
2. **Select Timezone**: In the Preferences section, use the timezone dropdown to select your timezone
3. **Use Detected Timezone** (Optional): If your browser's detected timezone is different from the selected one, you can click "Use detected: [timezone]" to automatically set it
4. **Automatic Save**: The timezone is saved automatically when you make a selection
5. **View Updated Timestamps**: All timestamps throughout the application will now display in your selected timezone

### Timezone Display Locations

Timestamps are displayed in your selected timezone in the following locations:
- **Dashboard**: Recent calls list
- **Calls Page**: All call date/time entries
- **Call Detail Page**: Individual call date/time
- **Settings Page**: Account created date

## Technical Details

### Database Schema

```sql
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'UTC';
```

### API Endpoints

- **GET /api/v1/user**: Returns user information including timezone preference
- **PATCH /api/v1/user/preferences**: Updates user preferences including timezone

Example request body:
```json
{
  "timezone": "America/New_York"
}
```

### Frontend Components

- **Timezone Utility** (`frontend/lib/timezone.ts`): Provides functions for formatting dates in specific timezones
- **Settings Page**: Includes timezone selector with 30+ common timezones
- **All Pages**: Updated to use the timezone-aware date formatting

### Supported Timezones

The application supports all IANA timezone identifiers, with a curated list of 30+ common timezones available in the dropdown, including:

- UTC
- US timezones (Eastern, Central, Mountain, Pacific, Alaska, Hawaii, Arizona)
- Canadian timezones (Toronto, Vancouver)
- Latin American timezones (Mexico City, São Paulo, Buenos Aires)
- European timezones (London, Paris, Berlin, Rome, Moscow, etc.)
- Asian timezones (Dubai, Mumbai, Bangkok, Singapore, Tokyo, etc.)
- Australian timezones (Sydney, Melbourne)
- Pacific timezones (Auckland)

## Troubleshooting

### Issue: Migration fails with "relation does not exist"

**Solution**: Ensure your database connection is working and the `users` table exists. Check your `DATABASE_URL` in the backend `.env` file.

### Issue: Timezone not saving

**Solution**: 
1. Check browser console for errors
2. Verify the backend server is running
3. Check that the timezone column was added to the database
4. Verify your authentication token is valid

### Issue: Timestamps still showing in wrong timezone

**Solution**:
1. Refresh the page after changing timezone
2. Clear browser cache
3. Verify the timezone was saved by checking the Settings page
4. Check browser console for any JavaScript errors

## Development Notes

### Adding More Timezones

To add more timezones to the dropdown, edit `frontend/lib/timezone.ts` and add entries to the `getCommonTimezones()` function:

```typescript
{ value: 'Your/Timezone', label: '(UTC±XX:XX) Your Label' }
```

### Custom Date Formatting

Use the `formatDateInTimezone()` function with custom Intl.DateTimeFormatOptions:

```typescript
import { formatDateInTimezone } from '@/lib/timezone';

const formatted = formatDateInTimezone(
  dateString,
  userTimezone,
  {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'long'
  }
);
```

## Support

If you encounter any issues or have questions about the timezone feature, please check the application logs:
- Backend logs: Check the console output where the backend server is running
- Frontend logs: Check the browser developer console (F12)

---

**Note**: The first time users log in after this update, their timezone will default to UTC. They can change it in Settings at any time.

