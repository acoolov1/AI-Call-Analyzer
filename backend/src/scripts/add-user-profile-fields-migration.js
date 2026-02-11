import { query, getPool, closePool } from '../config/database.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function addUserProfileFields() {
  console.log('🔄 Adding user profile fields to users table...');

  try {
    // Initialize pool
    getPool();

    // Read the migration SQL file
    const migrationPath = join(__dirname, '../config/migrations/add-user-profile-fields.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf8');

    // Execute the migration
    await query(migrationSQL);

    console.log('✅ Successfully added user profile fields to users table');

    // Light verification
    const result = await query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'users'
        AND column_name IN (
          'full_name','company_name','phone',
          'address_line1','address_line2','city','state','postal_code','country',
          'tos_accepted_at','privacy_accepted_at','tos_version','privacy_version'
        )
      ORDER BY column_name
    `);

    console.log(`✅ Verification: found ${result.rows.length} columns`);
  } catch (error) {
    console.error('❌ Error adding user profile fields:', error.message);
    throw error;
  } finally {
    await closePool();
  }
}

addUserProfileFields();

