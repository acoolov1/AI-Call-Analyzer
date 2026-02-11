import { query, getPool, closePool } from '../config/database.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applySupabaseTrigger() {
  console.log('🔄 Applying Supabase auth trigger (handle_new_user)...');

  try {
    getPool();

    const triggerPath = join(__dirname, '../config/supabase-trigger.sql');
    const sql = readFileSync(triggerPath, 'utf8');

    await query(sql);
    console.log('✅ Supabase trigger applied successfully');
  } catch (error) {
    console.error('❌ Failed to apply Supabase trigger:', error.message);
    throw error;
  } finally {
    await closePool();
  }
}

applySupabaseTrigger();

