import { getPool, closePool } from './src/config/database.js';

async function checkTimezone() {
  try {
    const pool = getPool();
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('\n🕐 Checking PostgreSQL timezone settings:\n');
    
    // Check timezone
    const tzResult = await pool.query('SHOW timezone');
    console.log('Database timezone:', tzResult.rows[0].TimeZone);
    
    // Check current time in different formats
    const timeResult = await pool.query(`
      SELECT 
        NOW() as now_default,
        NOW() AT TIME ZONE 'UTC' as now_utc,
        CURRENT_TIMESTAMP as current_timestamp,
        timezone('UTC', NOW()) as now_converted_to_utc
    `);
    
    console.log('\nCurrent time in database:');
    console.log('NOW():', timeResult.rows[0].now_default);
    console.log('NOW() AT TIME ZONE UTC:', timeResult.rows[0].now_utc);
    console.log('CURRENT_TIMESTAMP:', timeResult.rows[0].current_timestamp);
    console.log('timezone(UTC, NOW()):', timeResult.rows[0].now_converted_to_utc);
    
    // Check a sample call timestamp
    const callResult = await pool.query('SELECT id, created_at FROM calls ORDER BY created_at DESC LIMIT 1');
    if (callResult.rows.length > 0) {
      console.log('\nMost recent call:');
      console.log('created_at:', callResult.rows[0].created_at);
      console.log('toISOString():', callResult.rows[0].created_at.toISOString());
    }
    
    await closePool();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await closePool();
    process.exit(1);
  }
}

checkTimezone();

