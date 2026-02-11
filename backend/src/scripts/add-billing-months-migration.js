import { query, getPool, closePool } from '../config/database.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function addBillingMonthsTable() {
  console.log('🔄 Creating billing_months table...');

  try {
    // Initialize pool
    getPool();

    const migrationPath = join(__dirname, '../config/migrations/add-billing-months.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    await query(migrationSQL);

    console.log('✅ Successfully created billing_months table');

    // Verify table exists
    const result = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'billing_months'
    `);
    if (result.rows.length > 0) {
      console.log('✅ Verified: billing_months table exists');
    } else {
      console.log('⚠️  Warning: Could not verify billing_months table');
    }
  } catch (error) {
    console.error('❌ Error creating billing_months table:', error.message);
    throw error;
  } finally {
    await closePool();
  }
}

addBillingMonthsTable();

