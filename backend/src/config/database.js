import pg from 'pg';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

const { Pool } = pg;

let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.database.url,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // Increased from 2s to 10s for Supabase
    });

    pool.on('error', (err) => {
      logger.error({ err }, 'Unexpected error on idle database client');
    });

    // Test connection
    pool.query('SELECT NOW()', (err) => {
      if (err) {
        logger.error({ err }, 'Database connection failed');
      } else {
        logger.info('Database connected successfully');
      }
    });
  }

  return pool;
}

export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug({
      query: text.substring(0, 100),
      duration,
      rows: res.rowCount,
    }, 'Database query executed');
    return res;
  } catch (error) {
    logger.error({ error, query: text }, 'Database query failed');
    throw error;
  }
}

// Graceful shutdown
export async function closePool() {
  if (pool) {
    await pool.end();
    logger.info('Database pool closed');
  }
}

