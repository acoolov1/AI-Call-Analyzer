import { getPool, closePool } from '../config/database.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function fixTimezoneStorage() {
  try {
    console.log('\n🔧 Fixing timezone storage in database...\n');
    
    const pool = getPool();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('1️⃣  Converting TIMESTAMP columns to TIMESTAMPTZ...');
    
    // Convert calls table
    await pool.query(`
      ALTER TABLE calls 
        ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC',
        ALTER COLUMN processed_at TYPE TIMESTAMPTZ USING processed_at AT TIME ZONE 'UTC'
    `);
    console.log('   ✅ calls table updated');
    
    // Convert users table
    await pool.query(`
      ALTER TABLE users
        ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC',
        ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC'
    `);
    console.log('   ✅ users table updated');
    
    // Convert call_metadata table
    await pool.query(`
      ALTER TABLE call_metadata
        ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC'
    `);
    console.log('   ✅ call_metadata table updated');
    
    console.log('\n2️⃣  Verifying changes...');
    const result = await pool.query(`
      SELECT 
        table_name,
        column_name, 
        data_type 
      FROM information_schema.columns 
      WHERE table_name IN ('calls', 'users', 'call_metadata') 
        AND column_name LIKE '%_at'
      ORDER BY table_name, column_name
    `);
    
    console.log('\n   Column types:');
    result.rows.forEach(row => {
      console.log(`   - ${row.table_name}.${row.column_name}: ${row.data_type}`);
    });
    
    console.log('\n3️⃣  Testing timezone behavior...');
    const testResult = await pool.query(`
      SELECT 
        NOW() as server_time,
        NOW() AT TIME ZONE 'America/New_York' as eastern_time,
        NOW() AT TIME ZONE 'UTC' as utc_time
    `);
    
    console.log(`   Server time: ${testResult.rows[0].server_time}`);
    console.log(`   Eastern time: ${testResult.rows[0].eastern_time}`);
    console.log(`   UTC time: ${testResult.rows[0].utc_time}`);
    
    console.log('\n✅ Timezone storage fix completed!');
    console.log('\n📝 Note: Existing timestamps have been preserved.');
    console.log('   New timestamps will be stored correctly as UTC.');
    console.log('   If existing call timestamps are wrong, you may need to manually adjust them.\n');
    
    await closePool();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error fixing timezone storage:', error.message);
    console.error(error);
    await closePool();
    process.exit(1);
  }
}

fixTimezoneStorage();

