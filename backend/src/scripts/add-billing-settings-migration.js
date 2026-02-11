import { query, getPool, closePool } from '../config/database.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function addBillingSettingsColumn() {
  console.log('🔄 Adding billing_settings column to users table...');

  try {
    // Initialize pool
    getPool();

    const migrationPath = join(__dirname, '../config/migrations/add-billing-settings.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    await query(migrationSQL);

    console.log('✅ Successfully added billing_settings column to users table');

    // Verify column exists
    const result = await query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'billing_settings'
    `);
    if (result.rows.length > 0) {
      console.log('✅ Verified: billing_settings column exists');
    } else {
      console.log('⚠️  Warning: Could not verify billing_settings column');
    }
  } catch (error) {
    console.error('❌ Error adding billing_settings column:', error.message);
    throw error;
  } finally {
    await closePool();
  }
}

addBillingSettingsColumn();

