import { config } from '../config/env.js';
import { getPool } from '../config/database.js';
import { logger } from '../utils/logger.js';

const results = {
  database: { status: 'pending', message: '' },
  redis: { status: 'pending', message: '' },
  twilio: { status: 'pending', message: '' },
  openai: { status: 'pending', message: '' },
  supabase: { status: 'pending', message: '' },
};

async function testDatabase() {
  try {
    console.log('\n📊 Testing Database Connection...');
    const pool = getPool();
    const result = await pool.query('SELECT NOW(), version()');
    results.database = {
      status: 'success',
      message: `Connected! PostgreSQL ${result.rows[0].version.split(' ')[1]} - Server time: ${result.rows[0].now}`,
    };
    console.log('✅ Database: Connected successfully');
  } catch (error) {
    results.database = {
      status: 'failed',
      message: error.message,
    };
    console.log('❌ Database: Connection failed');
    console.log('   Error:', error.message);
    
    // Provide helpful suggestions
    if (error.code === 'ENOTFOUND') {
      console.log('   💡 Tip: Check that DATABASE_URL hostname is correct');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('   💡 Tip: Check that the database server is running and accessible');
    } else if (error.message.includes('password')) {
      console.log('   💡 Tip: Check that the database password in DATABASE_URL is correct');
    }
  }
}

async function testRedis() {
  try {
    console.log('\n🔴 Testing Redis Connection...');
    const Redis = (await import('ioredis')).default;
    const redis = new Redis(config.redis.url);
    
    await redis.ping();
    const info = await redis.info('server');
    const version = info.match(/redis_version:([^\r\n]+)/)?.[1] || 'unknown';
    
    results.redis = {
      status: 'success',
      message: `Connected! Redis ${version}`,
    };
    console.log('✅ Redis: Connected successfully');
    await redis.quit();
  } catch (error) {
    results.redis = {
      status: 'failed',
      message: error.message,
    };
    console.log('⚠️  Redis: Connection failed (optional - background jobs will not work)');
    console.log('   Error:', error.message);
    console.log('   💡 Tip: Redis is optional. Install it for background job processing.');
  }
}

async function testTwilio() {
  try {
    console.log('\n📞 Testing Twilio Configuration...');
    if (!config.twilio.accountSid || !config.twilio.authToken) {
      throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN not set');
    }
    
    // Just validate credentials are present and format
    if (config.twilio.accountSid.length < 30) {
      throw new Error('TWILIO_ACCOUNT_SID appears to be invalid (too short)');
    }
    
    results.twilio = {
      status: 'success',
      message: 'Credentials configured (not testing API call to avoid charges)',
    };
    console.log('✅ Twilio: Credentials configured');
  } catch (error) {
    results.twilio = {
      status: 'failed',
      message: error.message,
    };
    console.log('❌ Twilio: Configuration issue');
    console.log('   Error:', error.message);
  }
}

async function testOpenAI() {
  try {
    console.log('\n🤖 Testing OpenAI Configuration...');
    if (!config.openai.apiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }
    
    if (!config.openai.apiKey.startsWith('sk-')) {
      throw new Error('OPENAI_API_KEY format appears invalid (should start with sk-)');
    }
    
    results.openai = {
      status: 'success',
      message: 'API key configured (not testing API call to avoid charges)',
    };
    console.log('✅ OpenAI: API key configured');
  } catch (error) {
    results.openai = {
      status: 'failed',
      message: error.message,
    };
    console.log('❌ OpenAI: Configuration issue');
    console.log('   Error:', error.message);
  }
}

async function testSupabase() {
  try {
    console.log('\n🔷 Testing Supabase Configuration...');
    if (!config.database.supabaseUrl || !config.database.supabaseAnonKey) {
      throw new Error('SUPABASE_URL or SUPABASE_ANON_KEY not set');
    }
    
    // Validate URL format
    if (!config.database.supabaseUrl.startsWith('https://')) {
      throw new Error('SUPABASE_URL should start with https://');
    }
    
    results.supabase = {
      status: 'success',
      message: `URL and keys configured (${config.database.supabaseUrl})`,
    };
    console.log('✅ Supabase: Configuration looks good');
  } catch (error) {
    results.supabase = {
      status: 'failed',
      message: error.message,
    };
    console.log('❌ Supabase: Configuration issue');
    console.log('   Error:', error.message);
  }
}

async function runAllTests() {
  console.log('🔍 Testing All Connections...\n');
  console.log('=' .repeat(50));
  
  await testDatabase();
  await testRedis();
  await testTwilio();
  await testOpenAI();
  await testSupabase();
  
  console.log('\n' + '='.repeat(50));
  console.log('\n📋 Test Summary:\n');
  
  const statuses = {
    success: '✅',
    failed: '❌',
    pending: '⏳',
  };
  
  Object.entries(results).forEach(([service, result]) => {
    const icon = statuses[result.status] || '⏳';
    console.log(`${icon} ${service.toUpperCase()}: ${result.message}`);
  });
  
  const failed = Object.values(results).filter(r => r.status === 'failed');
  const critical = failed.filter((_, i) => ['database'].includes(Object.keys(results)[i]));
  
  console.log('\n' + '='.repeat(50));
  
  if (critical.length > 0) {
    console.log('\n⚠️  Critical issues found. Please fix these before running the application.');
    process.exit(1);
  } else if (failed.length > 0) {
    console.log('\n⚠️  Some optional services failed, but the app should still work.');
    process.exit(0);
  } else {
    console.log('\n🎉 All connections successful!');
    process.exit(0);
  }
}

runAllTests().catch(error => {
  console.error('\n❌ Test script error:', error);
  process.exit(1);
});

