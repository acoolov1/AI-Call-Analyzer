import { query, getPool, closePool } from '../config/database.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function addTwilioSettingsColumn() {
  console.log('🔄 Adding twilio_settings column to users table...');
  
  try {
    // Initialize pool
    getPool();
    
    // Read the migration SQL file
    const migrationPath = join(__dirname, '../config/migrations/add-twilio-settings.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    // Execute the migration
    await query(migrationSQL);
    
    console.log('✅ Successfully added twilio_settings column to users table');
    
    // Verify the column was added
    const result = await query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'twilio_settings'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Verification successful:');
      console.log('   Column:', result.rows[0].column_name);
      console.log('   Type:', result.rows[0].data_type);
      console.log('   Default:', result.rows[0].column_default?.substring(0, 100) + '...');
    } else {
      console.error('❌ Column verification failed - column not found');
    }
    
  } catch (error) {
    console.error('❌ Error adding twilio_settings column:', error.message);
    throw error;
  } finally {
    await closePool();
  }
}

addTwilioSettingsColumn();

