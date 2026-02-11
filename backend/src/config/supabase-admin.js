import { createClient } from '@supabase/supabase-js';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

let supabaseAdmin = null;

export function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    const supabaseUrl = config.database.supabaseUrl;
    const supabaseServiceRoleKey = config.database.supabaseServiceRoleKey;

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      logger.error('Supabase admin credentials not configured');
      throw new Error('Supabase admin credentials not configured');
    }

    supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    logger.info('Supabase admin client initialized');
  }

  return supabaseAdmin;
}

