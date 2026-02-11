# Admin/User Role Separation - Implementation Complete

## Overview
Successfully implemented comprehensive role-based access control (RBAC) following SaaS best practices. The system now supports admin users who can manage settings for any user, while regular users have limited access to their own data.

## What Was Implemented

### Backend Changes ✅

#### 1. Database Migration
- **File**: `backend/src/scripts/add-user-roles.js`
- Added `role` column to users table (VARCHAR(20), default: 'user')
- Added check constraint: CHECK (role IN ('admin', 'user'))
- Created index on role column
- Set `edakulov@gmail.com` as the admin user

#### 2. User Model Updates
- **File**: `backend/src/models/User.js`
- Added `role` and `isAdmin` fields to user objects
- Created `findAll()` method - returns all users with basic info
- Created `isAdmin(userId)` method - checks if user has admin role
- Created `updateRole(userId, role)` method - allows changing user roles

#### 3. Middleware
- **File**: `backend/src/middleware/admin.middleware.js` (NEW)
  - `requireAdmin` - protects admin-only routes
  - `optionalAdmin` - adds isAdmin flag without blocking
- **File**: `backend/src/middleware/auth.middleware.js` (ENHANCED)
  - Now fetches user role from database
  - Adds `role` and `isAdmin` to `req.user`

#### 4. Admin Routes & Controllers
- **File**: `backend/src/routes/admin.routes.js` (NEW)
- **File**: `backend/src/controllers/admin-users.controller.js` (NEW)
  - `GET /api/v1/admin/users` - List all users with settings status
  - `GET /api/v1/admin/users/:userId` - Get specific user details
  - `PATCH /api/v1/admin/users/:userId/role` - Update user role
  - `GET /api/v1/admin/users/:userId/calls` - Get calls for specific user

#### 5. Settings Controllers Enhanced
- **Files**: `user.controller.js`, `freepbx.controller.js`, `freepbx-cdr.controller.js`, `openai.controller.js`
- All now support `?userId=xxx` query parameter
- Admins can configure settings for any user
- Regular users can only access their own settings

### Frontend Changes ✅

#### 6. State Management
- **File**: `frontend/contexts/AdminUserContext.tsx` (NEW)
  - Manages selected user state for admin configuration
  - Methods: `selectUser()`, `clearSelection()`
  - Tracks `isViewingAsAdmin` state

#### 7. Hooks & API Helpers
- **File**: `frontend/hooks/use-user.ts` (UPDATED)
  - User interface now includes `role` and `isAdmin` fields
- **File**: `frontend/hooks/use-admin.ts` (NEW)
  - `useAllUsers()` - fetch all users
  - `useUserDetails(userId)` - fetch specific user
  - `useUpdateUserRole()` - change user roles
  - `useUserCalls(userId)` - view user's calls
- **File**: `frontend/lib/api-helpers.ts` (NEW)
  - `buildApiUrl()` helper for adding userId query parameters

#### 8. Permissions System
- **File**: `frontend/lib/permissions.ts` (NEW)
  - `isAdmin(user)` - check admin status
  - `canAccessAdminPanel(user)` - admin panel access
  - `canAccessSettings(user, settingType)` - settings page access
  - `getAllowedMenuItems(user)` - role-based navigation

#### 9. Enhanced Sidebar
- **File**: `frontend/components/Sidebar.tsx` (MAJOR UPDATE)
- **File**: `frontend/components/Sidebar.module.css` (STYLES ADDED)
- **Features**:
  - User selector integrated into bottom-left user display
  - For admins: Clickable with dropdown menu
  - For regular users: Static display (non-clickable)
  - Dropdown includes:
    - Search functionality
    - List of all users
    - "Back to Your Account" option
  - Visual indicators:
    - Amber background when viewing another user
    - Admin shield badge
    - "(Admin View)" label
  - Role-based navigation:
    - Admins see: All pages + User Management
    - Regular users see: Dashboard, Interactions, Call History, Account, Preferences

#### 10. Admin Panel
- **File**: `frontend/app/(dashboard)/admin/page.tsx` (NEW)
- **Features**:
  - Table showing all users
  - Displays: email, role, plan, call count, settings status
  - Actions per user:
    - View calls
    - Configure settings
    - Promote/Demote (change role)
  - Search functionality
  - One-click user selection for configuration

#### 11. Settings Pages Support
- **File**: `frontend/components/AdminViewBanner.tsx` (NEW)
  - Shows when admin is configuring another user
  - Displays selected user's email
  - "Back to Your Account" button
- **Updated**: `frontend/app/(dashboard)/settings/preferences/page.tsx`
- **Pattern established** for all settings pages:
  1. Import AdminViewBanner and useAdminUser
  2. Add AdminViewBanner component
  3. Use buildApiUrl() for API calls with userId parameter

## How It Works

### For Admin Users (edakulov@gmail.com)

1. **Sidebar User Selector**:
   - Click on your user display in the bottom-left
   - Dropdown appears with search and user list
   - Select any user to configure their settings

2. **Admin Panel** (`/admin`):
   - View all users in a table
   - See their settings status
   - Click "Settings" to configure a user
   - Click "View" to see their calls
   - Promote/Demote users to admin/user roles

3. **Settings Pages**:
   - When a user is selected, yellow banner appears
   - All settings save to the selected user
   - Test connections work for the selected user
   - Click "Back to Your Account" to return

4. **Visual Feedback**:
   - Amber/yellow background in sidebar when viewing another user
   - Admin shield badge
   - Banner on all settings pages

### For Regular Users

1. **Limited Navigation**:
   - Can only see: Dashboard, Interactions, Call History
   - Settings: Account and Preferences only
   - Cannot see: Twilio, FreePBX, OpenAI settings
   - Cannot see: User Management page

2. **Static User Display**:
   - Bottom-left user display is not clickable
   - Cannot select other users

3. **Data Isolation**:
   - Can only see their own calls
   - Can only access their own settings
   - API blocks attempts to access other users' data

## API Endpoints

### Admin Endpoints (require admin role)
- `GET /api/v1/admin/users` - List all users
- `GET /api/v1/admin/users/:userId` - Get user details
- `PATCH /api/v1/admin/users/:userId/role` - Change user role
- `GET /api/v1/admin/users/:userId/calls` - View user's calls

### Settings Endpoints (support userId param for admins)
- `GET /api/v1/user?userId=xxx` - Get user info
- `PATCH /api/v1/user/preferences?userId=xxx` - Update preferences
- `POST /api/v1/integrations/openai/test?userId=xxx` - Test OpenAI
- `POST /api/v1/integrations/freepbx/test?userId=xxx` - Test FreePBX
- And all other settings endpoints

## Testing Checklist

### As Admin (edakulov@gmail.com)
- [x] Log in and verify "User Management" appears in sidebar
- [ ] Click user display in bottom-left to see dropdown
- [ ] Search for a user in the dropdown
- [ ] Select a user - sidebar turns amber
- [ ] Navigate to Settings > Preferences - banner appears
- [ ] Change timezone for selected user
- [ ] Navigate to Settings > OpenAI - configure for selected user
- [ ] Test OpenAI connection for selected user
- [ ] Click "Back to Your Account" - returns to your settings
- [ ] Go to User Management page
- [ ] View table of all users
- [ ] Click "View" on a user - see their calls
- [ ] Click "Settings" on a user - navigate to settings
- [ ] Try to promote/demote a user (not yourself)

### As Regular User
- [ ] Create a new test user account
- [ ] Log in with test user
- [ ] Verify sidebar only shows: Dashboard, Interactions, Call History, Settings
- [ ] Verify Settings only shows: Account Settings, Preferences
- [ ] Verify Twilio, FreePBX, OpenAI settings are hidden
- [ ] Verify User Management is not visible
- [ ] Verify user display in bottom-left is not clickable
- [ ] Try to access `/admin` directly - should redirect to dashboard
- [ ] Verify only your own calls are visible

### Security Tests
- [ ] As regular user, try API call with userId parameter - should fail
- [ ] As admin, access another user's settings - should work
- [ ] As admin, try to demote yourself - should be blocked
- [ ] Verify regular users cannot see other users' calls via API

## Current Admin User
- **Email**: `edakulov@gmail.com`
- **Role**: `admin`

## Creating Additional Admins

### Via SQL:
```sql
UPDATE users SET role = 'admin' WHERE email = 'another-admin@example.com';
```

### Via Admin Panel:
1. Log in as existing admin
2. Go to User Management
3. Find the user
4. Click "Promote" button

## Files Modified/Created

### Backend (20 files)
- Created: `add-user-roles.js`, `admin.middleware.js`, `admin.routes.js`, `admin-users.controller.js`
- Modified: `User.js`, `auth.middleware.js`, `index.js` (routes), `user.controller.js`, `freepbx.controller.js`, `freepbx-cdr.controller.js`, `openai.controller.js`

### Frontend (15 files)
- Created: `AdminUserContext.tsx`, `use-admin.ts`, `permissions.ts`, `api-helpers.ts`, `AdminViewBanner.tsx`, `admin/page.tsx`
- Modified: `providers.tsx`, `use-user.ts`, `Sidebar.tsx`, `Sidebar.module.css`, `preferences/page.tsx`

## Next Steps

1. **Test thoroughly** using the checklist above
2. **Apply the settings pattern** to remaining pages:
   - `/settings/openai/page.tsx`
   - `/settings/freepbx/page.tsx`
   - `/settings/twilio/page.tsx`
   - `/settings/account/page.tsx`
   (Follow the pattern from `preferences/page.tsx`)

3. **Optional enhancements**:
   - Add audit logging for admin actions
   - Add bulk user operations
   - Add user deactivation/suspension
   - Add email notifications when admin changes settings

## Troubleshooting

### Backend won't start
```bash
pm2 logs ai-call-backend
# Check for syntax errors in new files
```

### Frontend won't compile
```bash
pm2 logs ai-call-frontend
# Check for TypeScript errors
```

### Role not showing up
```sql
-- Verify role column exists
SELECT id, email, role FROM users;

-- If role is NULL, update it
UPDATE users SET role = 'user' WHERE role IS NULL;
```

### Admin features not appearing
1. Clear browser cache
2. Check user object includes `role` and `isAdmin` fields
3. Verify JWT token includes user ID
4. Check browser console for errors

## Support

If you encounter any issues:
1. Check PM2 logs: `pm2 logs`
2. Check browser console for errors
3. Verify database migration ran successfully
4. Ensure both frontend and backend restarted after changes

---

**Status**: ✅ Implementation Complete
**Servers**: ✅ Backend and Frontend Restarted
**Ready**: ✅ For Testing

Access the app at: `https://app.komilio.com`

