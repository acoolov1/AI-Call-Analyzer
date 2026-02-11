import { getPool, query, closePool } from '../config/database.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  try {
    console.log('🔄 Adding recording retention fields to calls table...');

    getPool();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const sqlPath = path.join(__dirname, '../config/migrations/add-recording-retention-fields.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await query(sql);

    console.log('✅ Migration applied successfully');
    await closePool();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    logger.error({ error: error.message }, 'Failed to apply recording retention fields migration');
    await closePool();
    process.exit(1);
  }
}

run();

