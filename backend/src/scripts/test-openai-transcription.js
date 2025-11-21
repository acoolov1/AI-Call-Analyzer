import { config } from '../config/env.js';
import { OpenAIService } from '../services/openai.service.js';
import { logger } from '../utils/logger.js';

async function testOpenAITranscription() {
  console.log('\n🧪 Testing OpenAI Whisper Transcription...\n');
  
  // Check if API key is configured
  if (!config.openai.apiKey) {
    console.error('❌ OPENAI_API_KEY is not configured!');
    console.error('   Please set OPENAI_API_KEY in your .env file');
    process.exit(1);
  }
  
  console.log('✅ OpenAI API Key is configured');
  console.log(`   Key starts with: ${config.openai.apiKey.substring(0, 7)}...`);
  
  // Test with a simple audio file (you would need to provide a test file)
  // For now, just test the API connection
  try {
    console.log('\n📡 Testing OpenAI API connection...');
    
    // Test with a minimal API call to check if the key works
    const openai = new (await import('openai')).default({ apiKey: config.openai.apiKey });
    
    // Try to list models to verify API key works
    try {
      const models = await openai.models.list();
      console.log('✅ OpenAI API connection successful');
      console.log(`   Available models: ${models.data.length} models`);
      
      // Check if whisper-1 is available
      const whisperAvailable = models.data.some(m => m.id === 'whisper-1');
      if (whisperAvailable) {
        console.log('✅ Whisper-1 model is available');
      } else {
        console.log('⚠️  Whisper-1 model not found in list (but may still be available)');
      }
    } catch (error) {
      if (error.status === 401) {
        console.error('❌ OpenAI API Key is invalid!');
        console.error('   Please check your OPENAI_API_KEY in .env');
        process.exit(1);
      } else {
        console.warn('⚠️  Could not list models (this is okay, API key may still work)');
        console.warn(`   Error: ${error.message}`);
      }
    }
    
    // Test GPT model availability
    try {
      const chatResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say "test" if you can read this.' }],
        max_tokens: 10,
      });
      console.log('✅ GPT-4o-mini model is working');
      console.log(`   Response: ${chatResponse.choices[0].message.content}`);
    } catch (error) {
      console.error('❌ GPT-4o-mini model test failed');
      console.error(`   Error: ${error.message}`);
      if (error.status === 401) {
        console.error('   This suggests your API key is invalid');
      }
    }
    
    console.log('\n✅ OpenAI connection test complete!');
    console.log('\n💡 To test actual transcription, you would need to:');
    console.log('   1. Make a test call to your Twilio number');
    console.log('   2. Check the backend logs for transcription progress');
    console.log('   3. Check the database to see if transcript was saved');
    
  } catch (error) {
    console.error('\n❌ Error testing OpenAI:');
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error(`   Stack: ${error.stack}`);
    }
    process.exit(1);
  }
}

testOpenAITranscription().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

