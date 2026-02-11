import { getPool } from '../config/database.js';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  const pool = getPool();
  const migrationFile = join(__dirname, '../config/migrations/add-freepbx-web-url.sql');
  
  try {
    const sql = await fs.readFile(migrationFile, 'utf-8');
    await pool.query(sql);
    logger.info('Migration add-freepbx-web-url.sql completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  }
}

runMigration();

