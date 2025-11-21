import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from '../config/database.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Migrate calls to a specific user account
 */
async function migrateToUser(userEmail) {
  try {
    logger.info('Starting data migration...');

    // Read calls-history.json from root
    const callsHistoryPath = path.join(__dirname, '../../..', 'calls-history.json');
    
    if (!fs.existsSync(callsHistoryPath)) {
      logger.warn('calls-history.json not found. Checking alternative locations...');
      
      // Try in current directory
      const altPath = path.join(process.cwd(), 'calls-history.json');
      if (fs.existsSync(altPath)) {
        logger.info('Found calls-history.json in current directory');
        return await migrateFromFile(altPath, userEmail);
      }
      
      logger.error('calls-history.json not found. Please ensure the file exists in the project root.');
      return;
    }

    await migrateFromFile(callsHistoryPath, userEmail);
  } catch (error) {
    logger.error({ error: error.message }, 'Migration failed');
    throw error;
  }
}

async function migrateFromFile(filePath, userEmail) {
  const callsData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  
  if (!Array.isArray(callsData) || callsData.length === 0) {
    logger.info('No calls to migrate');
    return;
  }

  logger.info({ count: callsData.length }, 'Found calls to migrate');

  // Find user by email
  const userResult = await query('SELECT id, email FROM users WHERE email = $1', [userEmail]);
  
  if (userResult.rows.length === 0) {
    logger.error(`User with email ${userEmail} not found. Please create the user first in Supabase.`);
    return;
  }

  const userId = userResult.rows[0].id;
  logger.info({ userId, email: userEmail }, 'Migrating calls to user');

  // Migrate calls
  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const call of callsData) {
    try {
      // Check if call already exists
      const existing = await query(
        `SELECT id FROM calls 
         WHERE user_id = $1 
         AND caller_number = $2 
         AND created_at = $3 
         LIMIT 1`,
        [userId, call.callerNumber, new Date(call.createdAt)]
      );

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      // Insert call
      await query(
        `INSERT INTO calls (
          user_id, caller_number, caller_name, transcript, analysis,
          recording_url, status, created_at, updated_at, processed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $7, $7)`,
        [
          userId,
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

  console.log(`\n✅ Successfully migrated ${migrated} calls to user: ${userEmail}`);
  if (skipped > 0) {
    console.log(`⚠️  Skipped ${skipped} duplicate calls`);
  }
  if (errors > 0) {
    console.log(`❌ ${errors} calls failed to migrate`);
  }
}

// Get user email from command line or use default
const userEmail = process.argv[2];

if (!userEmail) {
  console.log('\n❌ Please provide your user email address');
  console.log('\nUsage:');
  console.log('  node src/scripts/migrate-to-current-user.js your-email@example.com');
  console.log('\nThis will migrate all calls from calls-history.json to your user account.');
  process.exit(1);
}

migrateToUser(userEmail)
  .then(() => {
    logger.info('Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ error }, 'Migration script failed');
    process.exit(1);
  });

