import { getPool, closePool } from './src/config/database.js';

async function verifyTimestamps() {
  const pool = getPool();
  await new Promise(r => setTimeout(r, 500));
  
  console.log('\n🔍 Checking current call timestamps...\n');
  
  // Get the most recent calls
  const result = await pool.query(`
    SELECT 
      caller_number,
      created_at,
      created_at AT TIME ZONE 'America/New_York' as eastern_time,
      created_at AT TIME ZONE 'UTC' as utc_time
    FROM calls 
    ORDER BY created_at DESC 
    LIMIT 5
  `);
  
  console.log('Recent calls (showing in both UTC and Eastern Time):\n');
  
  result.rows.forEach((row, i) => {
    console.log(`Call ${i + 1}: ${row.caller_number}`);
    console.log(`  Database (UTC):  ${row.created_at.toISOString()}`);
    console.log(`  Eastern Time:    ${row.eastern_time.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric', 
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: 'America/New_York'
    })}`);
    console.log('');
  });
  
  // Get current time for comparison
  const now = await pool.query(`
    SELECT 
      NOW() as db_time,
      NOW() AT TIME ZONE 'America/New_York' as eastern_now
  `);
  
  console.log('Current time comparison:');
  console.log(`  Database time (UTC): ${now.rows[0].db_time.toISOString()}`);
  console.log(`  Current Eastern:     ${now.rows[0].eastern_now.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric', 
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: 'America/New_York'
  })}`);
  
  const yourLocalTime = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric', 
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: 'America/New_York'
  });
  console.log(`  Your local time:     ${yourLocalTime}`);
  
  console.log('\n✅ If the Eastern Time matches when you actually made the calls, timestamps are correct!\n');
  
  await closePool();
  process.exit(0);
}

verifyTimestamps().catch(async e => {
  console.error('Error:', e.message);
  await closePool();
  process.exit(1);
});

