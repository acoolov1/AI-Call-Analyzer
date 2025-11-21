import { getPool, closePool } from './src/config/database.js';

async function applyFix() {
  const pool = getPool();
  await new Promise(r => setTimeout(r, 500));
  
  console.log('\n📊 Applying timestamp fix to existing calls...\n');
  
  const result = await pool.query(`
    UPDATE calls 
    SET 
      created_at = created_at - INTERVAL '5 hours',
      updated_at = updated_at - INTERVAL '5 hours',
      processed_at = CASE 
        WHEN processed_at IS NOT NULL THEN processed_at - INTERVAL '5 hours'
        ELSE NULL
      END
    WHERE created_at > NOW() - INTERVAL '7 days'
  `);
  
  console.log(`✅ Fixed ${result.rowCount} calls from the past week\n`);
  
  const sample = await pool.query('SELECT caller_number, created_at FROM calls ORDER BY created_at DESC LIMIT 3');
  console.log('Sample timestamps NOW:');
  sample.rows.forEach(r => console.log(`  - ${r.caller_number}: ${r.created_at.toISOString()}`));
  
  console.log('\n');
  await closePool();
  process.exit(0);
}

applyFix().catch(async e => {
  console.error('Error:', e.message);
  await closePool();
  process.exit(1);
});

