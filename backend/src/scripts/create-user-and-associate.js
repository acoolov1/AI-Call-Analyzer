import { query, getPool } from '../config/database.js';

async function createUserAndAssociateCalls(userEmailOrId) {
  try {
    console.log(`\n🔗 Creating user and associating calls: ${userEmailOrId}\n`);

    // Initialize database connection
    console.log('🔌 Connecting to database...');
    const pool = getPool();
    await pool.query('SELECT 1'); // Test connection
    console.log('✅ Database connected\n');

    let userId;
    let userEmail;
    
    // Check if input is a UUID (Supabase user ID) or email
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userEmailOrId);
    
    if (isUUID) {
      // Input is a user ID
      userId = userEmailOrId;
      console.log(`📋 Input is a user ID: ${userId}`);
      
      // Check if user exists
      const userResult = await query('SELECT id, email FROM users WHERE id = $1', [userId]);
      if (userResult.rows.length > 0) {
        userEmail = userResult.rows[0].email;
        console.log(`✅ User found: ${userEmail} (${userId})`);
      } else {
        // User doesn't exist - need email to create
        console.log(`⚠️  User ID ${userId} not found in database.`);
        console.log(`\nTo create this user, we need their email address.`);
        console.log(`\nOption 1: Get email from Supabase Dashboard`);
        console.log(`  1. Go to Supabase Dashboard → Authentication → Users`);
        console.log(`  2. Find user with ID: ${userId}`);
        console.log(`  3. Copy their email`);
        console.log(`  4. Run: node src/scripts/create-user-and-associate.js [EMAIL] ${userId}`);
        console.log(`\nOption 2: Provide email as first argument`);
        console.log(`  Run: node src/scripts/create-user-and-associate.js [EMAIL] ${userId}`);
        process.exit(1);
      }
    } else {
      // Input is an email
      userEmail = userEmailOrId;
      console.log(`📋 Input is an email: ${userEmail}`);
      
      // Check if user exists by email
      let userResult = await query('SELECT id, email FROM users WHERE email = $1', [userEmail]);
      
      if (userResult.rows.length === 0) {
        // User doesn't exist - we need their Supabase user ID
        console.log(`⚠️  User ${userEmail} not found in database.`);
        console.log(`\nTo create this user, we need their Supabase user ID.`);
        console.log(`\nOption 1: Get user ID from Supabase Dashboard`);
        console.log(`  1. Go to Supabase Dashboard → Authentication → Users`);
        console.log(`  2. Find user with email: ${userEmail}`);
        console.log(`  3. Copy their User UID`);
        console.log(`  4. Run: node src/scripts/create-user-and-associate.js ${userEmail} [USER_ID]`);
        console.log(`\nOption 2: Use signup page in frontend to create user`);
        
        // Check if user ID was provided as second argument
        const providedUserId = process.argv[3];
        if (providedUserId) {
          console.log(`\n✅ Using provided user ID: ${providedUserId}`);
          userId = providedUserId;
          
          // Create user in database
          await query(
            `INSERT INTO users (id, email, subscription_tier, created_at, updated_at)
             VALUES ($1, $2, 'free', NOW(), NOW())
             ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
            [userId, userEmail]
          );
          console.log(`✅ Created user in database: ${userEmail} (${userId})`);
        } else {
          console.log(`\n❌ Cannot proceed without user ID.`);
          process.exit(1);
        }
      } else {
        userId = userResult.rows[0].id;
        console.log(`✅ User already exists: ${userEmail} (${userId})`);
      }
    }

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
      await pool.end();
      process.exit(0);
    }

    // Update calls to associate with user
    console.log(`\n🔄 Associating ${callCount} calls with user ${userEmail}...`);
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

const userEmailOrId = process.argv[2];

if (!userEmailOrId) {
  console.log('\n❌ Please provide your user email address or Supabase user ID');
  console.log('\nUsage:');
  console.log('  node src/scripts/create-user-and-associate.js your-email@example.com [supabase-user-id]');
  console.log('  OR');
  console.log('  node src/scripts/create-user-and-associate.js [supabase-user-id] your-email@example.com');
  console.log('\nIf user doesn\'t exist, you\'ll need both email and user ID.');
  process.exit(1);
}

createUserAndAssociateCalls(userEmailOrId);
