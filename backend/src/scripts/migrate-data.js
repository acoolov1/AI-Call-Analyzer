import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, getPool } from '../config/database.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Migrate data from calls-history.json to database
 */
async function migrateData() {
  try {
    logger.info('Starting data migration...');

    // Read calls-history.json
    const callsHistoryPath = path.join(__dirname, '../../..', 'calls-history.json');
    
    if (!fs.existsSync(callsHistoryPath)) {
      logger.warn('calls-history.json not found, skipping migration');
      return;
    }

    const callsData = JSON.parse(fs.readFileSync(callsHistoryPath, 'utf8'));
    
    if (!Array.isArray(callsData) || callsData.length === 0) {
      logger.info('No calls to migrate');
      return;
    }

    logger.info({ count: callsData.length }, 'Found calls to migrate');

    // Create default user if not exists
    const defaultEmail = process.env.DEFAULT_USER_EMAIL || 'migrated@example.com';
    const defaultUserId = process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000000';

    // Check if user exists
    const userCheck = await query('SELECT id FROM users WHERE id = $1', [defaultUserId]);
    
    if (userCheck.rows.length === 0) {
      // Create default user
      await query(
        `INSERT INTO users (id, email, subscription_tier, created_at, updated_at)
         VALUES ($1, $2, 'free', NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [defaultUserId, defaultEmail]
      );
      logger.info({ userId: defaultUserId, email: defaultEmail }, 'Created default user');
    }

    // Migrate calls
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const call of callsData) {
      try {
        // Check if call already exists (by caller number and created date)
        const existing = await query(
          `SELECT id FROM calls 
           WHERE caller_number = $1 
           AND created_at = $2 
           LIMIT 1`,
          [call.callerNumber, new Date(call.createdAt)]
        );

        if (existing.rows.length > 0) {
          logger.debug({ callerNumber: call.callerNumber, createdAt: call.createdAt }, 'Call already exists, skipping');
          skipped++;
          continue;
        }

        // Insert call
        await query(
          `INSERT INTO calls (
            user_id, caller_number, caller_name, transcript, analysis,
            recording_url, status, created_at, updated_at, processed_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $7, $7)
          RETURNING id`,
          [
            defaultUserId,
            call.callerNumber,
            call.callerName || null,
            call.transcript || null,
            call.analysis || null,
            call.recordingUrl || null,
            new Date(call.createdAt),
          ]
        );

        migrated++;
      } catch (error) {
        logger.error({ error: error.message, call }, 'Error migrating call');
        errors++;
      }
    }

    logger.info({
      total: callsData.length,
      migrated,
      skipped,
      errors,
    }, 'Migration completed');

  } catch (error) {
    logger.error({ error: error.message }, 'Migration failed');
    throw error;
  }
}

// Run migration
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateData()
    .then(() => {
      logger.info('Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'Migration script failed');
      process.exit(1);
    });
}

export { migrateData };

