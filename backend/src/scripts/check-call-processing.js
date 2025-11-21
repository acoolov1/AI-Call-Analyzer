import { query, getPool } from '../config/database.js';

async function checkCallProcessing() {
  console.log('\n🔍 Checking Call Processing Status...\n');
  
  // Initialize database connection
  getPool();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  try {
    // Get calls with their processing status
    const result = await query(`
      SELECT 
        id,
        call_sid,
        caller_number,
        status,
        recording_url IS NOT NULL as has_recording,
        transcript IS NOT NULL as has_transcript,
        analysis IS NOT NULL as has_analysis,
        created_at,
        processed_at,
        EXTRACT(EPOCH FROM (COALESCE(processed_at, NOW()) - created_at)) as processing_time_seconds
      FROM calls
      ORDER BY created_at DESC
      LIMIT 20
    `);
    
    if (result.rows.length === 0) {
      console.log('⚠️  No calls found in database');
      return;
    }
    
    console.log(`Found ${result.rows.length} recent calls:\n`);
    
    result.rows.forEach((call, index) => {
      const statusEmoji = {
        'pending': '⏳',
        'processing': '🔄',
        'completed': '✅',
        'failed': '❌'
      }[call.status] || '❓';
      
      console.log(`${statusEmoji} Call ${index + 1}:`);
      console.log(`  ID: ${call.id}`);
      console.log(`  Status: ${call.status}`);
      console.log(`  Caller: ${call.caller_number}`);
      console.log(`  Recording: ${call.has_recording ? '✅' : '❌'}`);
      console.log(`  Transcript: ${call.has_transcript ? '✅' : '❌'}`);
      console.log(`  Analysis: ${call.has_analysis ? '✅' : '❌'}`);
      console.log(`  Created: ${new Date(call.created_at).toLocaleString()}`);
      if (call.processed_at) {
        console.log(`  Processed: ${new Date(call.processed_at).toLocaleString()}`);
        console.log(`  Processing time: ${Math.round(call.processing_time_seconds)}s`);
      } else {
        console.log(`  Processed: Not yet processed`);
        if (call.status === 'processing') {
          const age = Math.round(call.processing_time_seconds);
          console.log(`  ⚠️  Stuck in processing for ${age} seconds!`);
        }
      }
      console.log('');
    });
    
    // Summary
    const stats = {
      total: result.rows.length,
      pending: result.rows.filter(c => c.status === 'pending').length,
      processing: result.rows.filter(c => c.status === 'processing').length,
      completed: result.rows.filter(c => c.status === 'completed').length,
      failed: result.rows.filter(c => c.status === 'failed').length,
      withRecording: result.rows.filter(c => c.has_recording).length,
      withTranscript: result.rows.filter(c => c.has_transcript).length,
      withAnalysis: result.rows.filter(c => c.has_analysis).length,
    };
    
    console.log('\n📊 Summary:');
    console.log(`  Total calls: ${stats.total}`);
    console.log(`  Status: ${stats.completed} completed, ${stats.processing} processing, ${stats.failed} failed, ${stats.pending} pending`);
    console.log(`  With recording: ${stats.withRecording}`);
    console.log(`  With transcript: ${stats.withTranscript} (${Math.round(stats.withTranscript / stats.total * 100)}%)`);
    console.log(`  With analysis: ${stats.withAnalysis} (${Math.round(stats.withAnalysis / stats.total * 100)}%)`);
    
    // Warnings
    if (stats.processing > 0) {
      console.log('\n⚠️  WARNING: Some calls are stuck in "processing" status!');
      console.log('   This suggests the processing pipeline may have failed.');
      console.log('   Check backend logs for errors.');
    }
    
    if (stats.withRecording > 0 && stats.withTranscript === 0) {
      console.log('\n⚠️  WARNING: Calls have recordings but no transcripts!');
      console.log('   This suggests transcription is failing.');
      console.log('   Check:');
      console.log('   1. OpenAI API key is valid (run: npm run test-openai)');
      console.log('   2. Backend logs for transcription errors');
      console.log('   3. Recording webhook is being called');
    }
    
    if (stats.withTranscript > 0 && stats.withAnalysis === 0) {
      console.log('\n⚠️  WARNING: Calls have transcripts but no analysis!');
      console.log('   This suggests analysis is failing.');
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

checkCallProcessing().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

