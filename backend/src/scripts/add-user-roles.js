import { query, getPool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import readline from 'readline';

/**
 * Migration script to add role column to users table
 * Adds role-based access control (RBAC) support
 */
async function addUserRoles() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => new Promise((resolve) => {
    rl.question(prompt, resolve);
  });

  try {
    console.log('\n🔧 Starting user roles migration...\n');
    logger.info('Starting user roles migration');

    // Initialize database connection
    getPool();

    // Step 1: Add role column
    console.log('📋 Step 1: Adding role column to users table...');
    await query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'
    `);
    console.log('✅ Role column added');

    // Step 2: Add check constraint
    console.log('\n📋 Step 2: Adding role check constraint...');
    await query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'check_user_role'
        ) THEN
          ALTER TABLE users 
          ADD CONSTRAINT check_user_role CHECK (role IN ('admin', 'user'));
        END IF;
      END $$;
    `);
    console.log('✅ Check constraint added');

    // Step 3: Create index
    console.log('\n📋 Step 3: Creating index on role column...');
    await query(`
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)
    `);
    console.log('✅ Index created');

    // Step 4: Set default role for existing users
    console.log('\n📋 Step 4: Setting default role for existing users...');
    const updateResult = await query(`
      UPDATE users 
      SET role = 'user' 
      WHERE role IS NULL
    `);
    console.log(`✅ Updated ${updateResult.rowCount} users to 'user' role`);

    // Step 5: Prompt for admin user
    console.log('\n📋 Step 5: Setting up admin account...');
    
    // List existing users
    const usersResult = await query(`
      SELECT id, email, role FROM users ORDER BY created_at ASC
    `);

    if (usersResult.rows.length === 0) {
      console.log('⚠️  No users found in database. Please create a user first.');
      rl.close();
      return;
    }

    console.log('\n👥 Existing users:');
    usersResult.rows.forEach((user, index) => {
      console.log(`  ${index + 1}. ${user.email} (${user.role})`);
    });

    const adminEmail = await question('\n✏️  Enter email of user to make admin (or press Enter to skip): ');

    if (adminEmail.trim()) {
      const result = await query(`
        UPDATE users 
        SET role = 'admin' 
        WHERE email = $1
        RETURNING id, email, role
      `, [adminEmail.trim()]);

      if (result.rows.length > 0) {
        console.log(`\n✅ Successfully set ${result.rows[0].email} as admin!`);
        logger.info({ userId: result.rows[0].id, email: result.rows[0].email }, 'User set as admin');
      } else {
        console.log(`\n⚠️  User with email ${adminEmail.trim()} not found.`);
      }
    } else {
      console.log('\n⏭️  Skipped admin setup. You can manually set admin later with:');
      console.log('   UPDATE users SET role = \'admin\' WHERE email = \'your-email@example.com\';');
    }

    // Summary
    console.log('\n✅ Migration completed successfully!\n');
    console.log('Summary:');
    console.log('  - Added role column (VARCHAR(20), default: \'user\')');
    console.log('  - Added check constraint (admin | user)');
    console.log('  - Created index on role column');
    console.log('  - Updated existing users\n');

    logger.info('User roles migration completed successfully');

    rl.close();
    const poolInstance = getPool();
    await poolInstance.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    logger.error({ error: error.message, stack: error.stack }, 'Migration failed');
    rl.close();
    const poolInstance = getPool();
    await poolInstance.end();
    process.exit(1);
  }
}

// Run migration
addUserRoles();

