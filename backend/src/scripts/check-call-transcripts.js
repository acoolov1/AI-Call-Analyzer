import { query, getPool } from '../config/database.js';
import { config } from '../config/env.js';

async function checkCallTranscripts() {
  console.log('\n🔍 Checking Call Transcripts in Database...\n');
  
  // Initialize database connection
  getPool();
  
  // Wait a moment for connection to establish
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    // Get recent calls
    const result = await query(`
      SELECT 
        id,
        call_sid,
        caller_number,
        status,
        transcript,
        analysis,
        created_at,
        processed_at,
        LENGTH(transcript) as transcript_length,
        LENGTH(analysis) as analysis_length
      FROM calls
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    if (result.rows.length === 0) {
      console.log('⚠️  No calls found in database');
      return;
    }
    
    console.log(`Found ${result.rows.length} recent calls:\n`);
    
    result.rows.forEach((call, index) => {
      console.log(`Call ${index + 1}:`);
      console.log(`  ID: ${call.id}`);
      console.log(`  Call SID: ${call.call_sid}`);
      console.log(`  Caller: ${call.caller_number}`);
      console.log(`  Status: ${call.status}`);
      console.log(`  Created: ${new Date(call.created_at).toLocaleString()}`);
      console.log(`  Processed: ${call.processed_at ? new Date(call.processed_at).toLocaleString() : 'Not processed'}`);
      console.log(`  Transcript: ${call.transcript ? `✅ ${call.transcript_length} characters` : '❌ Missing'}`);
      console.log(`  Analysis: ${call.analysis ? `✅ ${call.analysis_length} characters` : '❌ Missing'}`);
      
      if (call.transcript) {
        const preview = call.transcript.substring(0, 100);
        console.log(`  Transcript preview: "${preview}${call.transcript.length > 100 ? '...' : ''}"`);
      }
      
      if (call.analysis) {
        const preview = call.analysis.substring(0, 100);
        console.log(`  Analysis preview: "${preview}${call.analysis.length > 100 ? '...' : ''}"`);
      }
      
      console.log('');
    });
    
    // Summary
    const withTranscript = result.rows.filter(c => c.transcript).length;
    const withAnalysis = result.rows.filter(c => c.analysis).length;
    const completed = result.rows.filter(c => c.status === 'completed').length;
    const processing = result.rows.filter(c => c.status === 'processing').length;
    const failed = result.rows.filter(c => c.status === 'failed').length;
    const pending = result.rows.filter(c => c.status === 'pending').length;
    
    console.log('\n📊 Summary:');
    console.log(`  Total calls: ${result.rows.length}`);
    console.log(`  With transcript: ${withTranscript} (${Math.round(withTranscript / result.rows.length * 100)}%)`);
    console.log(`  With analysis: ${withAnalysis} (${Math.round(withAnalysis / result.rows.length * 100)}%)`);
    console.log(`  Status: ${completed} completed, ${processing} processing, ${failed} failed, ${pending} pending`);
    
    if (withTranscript === 0) {
      console.log('\n⚠️  WARNING: No calls have transcripts!');
      console.log('   This suggests transcription is not working.');
      console.log('   Check:');
      console.log('   1. OpenAI API key is configured correctly');
      console.log('   2. Calls are being processed (check backend logs)');
      console.log('   3. No errors in the processing pipeline');
    }
    
  } catch (error) {
    console.error('❌ Error checking calls:');
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack}`);
    }
    process.exit(1);
  }
}

checkCallTranscripts().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

