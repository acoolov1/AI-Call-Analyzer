import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, getPool } from '../config/database.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Set up database schema
 */
async function setupDatabase() {
  try {
    logger.info('Setting up database schema...');

    // Read schema file
    const schemaPath = path.join(__dirname, '../config/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute schema
    await query(schema);

    logger.info('Database schema created successfully');
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to set up database schema');
    throw error;
  }
}

// Run setup
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDatabase()
    .then(() => {
      logger.info('Database setup completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'Database setup failed');
      process.exit(1);
    });
}

export { setupDatabase };

