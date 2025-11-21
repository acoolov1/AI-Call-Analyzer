import { getPool, closePool } from './src/config/database.js';

async function fix() {
  try {
    console.log('\n🔧 Fixing timezone storage...\n');
    const pool = getPool();
    await new Promise(r => setTimeout(r, 500));
    
    await pool.query(`ALTER TABLE calls ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC'`);
    await pool.query(`ALTER TABLE calls ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC'`);
    await pool.query(`ALTER TABLE calls ALTER COLUMN processed_at TYPE TIMESTAMPTZ USING processed_at AT TIME ZONE 'UTC'`);
    await pool.query(`ALTER TABLE users ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC'`);
    await pool.query(`ALTER TABLE users ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC'`);
    await pool.query(`ALTER TABLE call_metadata ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC'`);
    
    console.log('✅ Fixed! All timestamp columns now use TIMESTAMPTZ\n');
    await closePool();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    await closePool();
    process.exit(1);
  }
}
fix();

