-- ===========================================================
-- Add Super Admin role + capability flags
-- ===========================================================
-- Adds:
--  - role allowed values: super_admin | admin | user
--  - can_use_app boolean (default true)
--  - can_use_freepbx_manager boolean (default false)
--
-- Also backfills:
--  - edakulov@gmail.com => super_admin + both capabilities true
--  - existing admins => can_use_freepbx_manager=true (and can_use_app=true)
-- ===========================================================

-- 1) Ensure role column exists
ALTER TABLE users
ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';

-- 2) Capability flags
ALTER TABLE users
ADD COLUMN IF NOT EXISTS can_use_app BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS can_use_freepbx_manager BOOLEAN NOT NULL DEFAULT false;

-- 3) Update / replace role constraint (old: admin|user)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_user_role') THEN
    ALTER TABLE users DROP CONSTRAINT check_user_role;
  END IF;
END $$;

ALTER TABLE users
ADD CONSTRAINT check_user_role CHECK (role IN ('super_admin', 'admin', 'user'));

-- 4) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_can_use_app ON users(can_use_app);
CREATE INDEX IF NOT EXISTS idx_users_can_use_freepbx_manager ON users(can_use_freepbx_manager);

-- 5) Backfill defaults for existing rows (if older rows had nulls)
UPDATE users
SET can_use_app = true
WHERE can_use_app IS NULL;

UPDATE users
SET can_use_freepbx_manager = false
WHERE can_use_freepbx_manager IS NULL;

-- Existing admins should, by default, have access to FreePBX Manager + app
UPDATE users
SET
  can_use_app = true,
  can_use_freepbx_manager = true
WHERE role = 'admin';

-- Ensure the owner account is super admin with full access
UPDATE users
SET
  role = 'super_admin',
  can_use_app = true,
  can_use_freepbx_manager = true
WHERE lower(email) = 'edakulov@gmail.com';

