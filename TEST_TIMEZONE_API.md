# Timezone API Testing Guide

## Step 1: Check Browser Console

When you try to save the timezone, **open your browser's Developer Console** (press F12) and look for these messages:

1. `Saving timezone: [timezone name]`
2. `Timezone response: [response data]`
3. Or error messages like:
   - `Error saving timezone:`
   - `Error response:`
   - `Error status:`

**Please copy and paste ALL the console messages** that appear when you try to save the timezone.

## Step 2: Check Backend Server

Make sure your backend server is running and was **restarted after the changes**.

### To restart the backend:
```bash
# Stop the backend server (Ctrl+C)
# Then restart it:
cd backend
npm start
```

You should see:
```
🚀 Server running on http://localhost:3000
💚 Health check: http://localhost:3000/health
```

## Step 3: Test the Health Endpoint

Open this URL in your browser:
```
http://localhost:3000/health
```

You should see:
```json
{
  "status": "healthy",
  "timestamp": "...",
  "database": "connected",
  "metrics": {...}
}
```

## Step 4: Manual API Test (Optional)

If you have a tool like Postman or can use curl, test the preferences endpoint directly:

### Get your auth token first:
1. Open browser DevTools (F12)
2. Go to Application tab > Session Storage
3. Find your authentication token

### Test the API:
```bash
# Replace YOUR_TOKEN with your actual token
curl -X PATCH http://localhost:3000/api/v1/user/preferences \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"timezone":"America/New_York"}'
```

## Common Issues and Solutions

### Issue 1: "Failed to save timezone"
**Possible causes:**
- Backend server not running
- Backend not restarted after code changes
- Authentication token expired
- CORS issue

**Solution:**
1. Restart backend server
2. Logout and login again (to get new token)
3. Check backend console for errors

### Issue 2: Network Error
**Possible causes:**
- Backend server on wrong port
- Frontend pointing to wrong API URL

**Solution:**
1. Check `backend/.env` - should have `PORT=3000`
2. Check `frontend/.env.local` - should have `NEXT_PUBLIC_API_URL=http://localhost:3000`

### Issue 3: 401 Unauthorized
**Possible causes:**
- Expired or invalid token
- Not logged in

**Solution:**
1. Logout and login again
2. Check if authentication is working for other pages

### Issue 4: 404 Not Found
**Possible causes:**
- Route not registered
- Backend server not restarted

**Solution:**
1. Restart backend server
2. Verify the route exists in `backend/src/routes/api.routes.js`

## What to Share for Debugging

Please provide:
1. **Browser Console Output** (all messages when saving timezone)
2. **Backend Console Output** (any errors shown in terminal)
3. **Network Tab Info** (from DevTools):
   - Request URL
   - Request Method
   - Status Code
   - Response Body
4. **Your Environment**:
   - Backend URL: `echo $NEXT_PUBLIC_API_URL` or check `.env.local`
   - Backend Port: Check `backend/.env` PORT setting

---

## Quick Test Checklist

- [ ] Backend server is running on port 3000
- [ ] Frontend server is running on port 3001
- [ ] You can see other pages (Dashboard, Calls) working
- [ ] Health endpoint returns "healthy"
- [ ] You're logged in (other API calls work)
- [ ] Browser console shows detailed error messages
- [ ] Both servers were restarted after the changes

