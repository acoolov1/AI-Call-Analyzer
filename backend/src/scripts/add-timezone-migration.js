import { getPool, query, closePool } from '../config/database.js';
import { logger } from '../utils/logger.js';

async function addTimezoneColumn() {
  try {
    console.log('🔄 Adding timezone column to users table...');
    
    // Initialize database connection
    const pool = getPool();
    
    // Wait a moment for the pool to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Add timezone column if it doesn't exist
    await query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'UTC'
    `);
    
    console.log('✅ Successfully added timezone column');
    
    // Verify the column was added
    const result = await query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'timezone'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Verified: timezone column exists');
      console.log('   Column details:', result.rows[0]);
    } else {
      console.log('⚠️  Warning: Could not verify timezone column');
    }
    
    await closePool();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding timezone column:', error);
    logger.error({ error: error.message }, 'Failed to add timezone column');
    await closePool();
    process.exit(1);
  }
}

addTimezoneColumn();

