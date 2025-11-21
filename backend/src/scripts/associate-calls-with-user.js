import { query, getPool } from '../config/database.js';

async function associateCallsWithUser(userEmail) {
  try {
    console.log(`\n🔗 Associating calls with user: ${userEmail}\n`);

    // Initialize database connection
    const pool = getPool();
    console.log('✅ Database connected');

    // Find user by email
    const userResult = await query('SELECT id, email FROM users WHERE email = $1', [userEmail]);
    
    if (userResult.rows.length === 0) {
      console.error(`❌ User with email ${userEmail} not found!`);
      console.log('\nAvailable users:');
      const allUsers = await query('SELECT id, email FROM users');
      allUsers.rows.forEach(user => {
        console.log(`  - ${user.email} (${user.id})`);
      });
      process.exit(1);
    }

    const userId = userResult.rows[0].id;
    console.log(`✅ Found user: ${userEmail} (${userId})`);

    // Get default user ID
    const defaultUserId = process.env.DEFAULT_USER_ID || '00000000-0000-0000-0000-000000000000';

    // Count calls for default user
    const countResult = await query(
      'SELECT COUNT(*) as count FROM calls WHERE user_id = $1',
      [defaultUserId]
    );
    const callCount = parseInt(countResult.rows[0].count, 10);

    console.log(`\n📞 Found ${callCount} calls associated with default user`);

    if (callCount === 0) {
      console.log('✅ No calls to associate');
      process.exit(0);
    }

    // Update calls to associate with user
    const updateResult = await query(
      'UPDATE calls SET user_id = $1 WHERE user_id = $2 RETURNING id',
      [userId, defaultUserId]
    );

    console.log(`✅ Associated ${updateResult.rows.length} calls with user ${userEmail}`);

    // Also update DEFAULT_USER_ID for future calls
    console.log(`\n💡 To make future calls associate with this user automatically:`);
    console.log(`   Set DEFAULT_USER_ID=${userId} in backend/.env`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

const userEmail = process.argv[2];

if (!userEmail) {
  console.log('\n❌ Please provide your user email address');
  console.log('\nUsage:');
  console.log('  node src/scripts/associate-calls-with-user.js your-email@example.com');
  console.log('\nThis will associate all calls with the default user to your account.');
  process.exit(1);
}

associateCallsWithUser(userEmail);

