import { getPool, closePool } from './src/config/database.js';

async function fixExistingTimestamps() {
  try {
    console.log('\n🔧 Fixing existing call timestamps...\n');
    const pool = getPool();
    await new Promise(r => setTimeout(r, 500));
    
    // Get count of calls
    const countResult = await pool.query('SELECT COUNT(*) FROM calls');
    const totalCalls = parseInt(countResult.rows[0].count);
    console.log(`Found ${totalCalls} calls to check\n`);
    
    if (totalCalls === 0) {
      console.log('No calls to fix!');
      await closePool();
      process.exit(0);
    }
    
    // Show sample of current timestamps
    console.log('Sample of CURRENT timestamps:');
    const sampleBefore = await pool.query('SELECT id, caller_number, created_at FROM calls ORDER BY created_at DESC LIMIT 3');
    sampleBefore.rows.forEach(row => {
      console.log(`  - ${row.caller_number}: ${row.created_at.toISOString()}`);
    });
    
    console.log('\n❓ The database was storing timestamps 5 hours too late.');
    console.log('   Do you want to subtract 5 hours from all existing calls?');
    console.log('\n   Type "yes" to fix, or just close this to skip.\n');
    
    // For now, let's just show what WOULD happen
    console.log('Preview of what timestamps WOULD become:');
    const preview = await pool.query(`
      SELECT 
        id,
        caller_number,
        created_at,
        created_at - INTERVAL '5 hours' as corrected_time
      FROM calls 
      ORDER BY created_at DESC 
      LIMIT 3
    `);
    
    preview.rows.forEach(row => {
      console.log(`  - ${row.caller_number}:`);
      console.log(`    Current:   ${row.created_at.toISOString()}`);
      console.log(`    Corrected: ${row.corrected_time.toISOString()}`);
    });
    
    console.log('\n⚠️  To apply this fix, run:');
    console.log(`   UPDATE calls SET created_at = created_at - INTERVAL '5 hours';`);
    console.log(`   UPDATE calls SET updated_at = updated_at - INTERVAL '5 hours';`);
    console.log('\n   Or create a confirmation prompt in this script.\n');
    
    await closePool();
    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    await closePool();
    process.exit(1);
  }
}

fixExistingTimestamps();

