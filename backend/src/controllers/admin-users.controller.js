import { User } from '../models/User.js';
import { Call } from '../models/Call.js';
import { query } from '../config/database.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getSupabaseAdmin } from '../config/supabase-admin.js';

export class AdminUsersController {
  /**
   * GET /api/v1/admin/users
   * List all users with their settings status
   */
  static async listUsers(req, res, next) {
    try {
      console.log('\n👥 Admin fetching all users...');
      
      const users = await User.findAll();
      
      // Enhance user data with additional info
      const enhancedUsers = await Promise.all(users.map(async (user) => {
        // Count calls for each user
        const callCountResult = await query(
          'SELECT COUNT(*) as count FROM calls WHERE user_id = $1',
          [user.id]
        );
        
        // Get settings status
        const userDetail = await User.findById(user.id);
        
        return {
          ...user,
          callCount: parseInt(callCountResult.rows[0].count, 10),
          hasOpenAISettings: userDetail.openaiSettings?.hasApiKey || false,
          hasFreePBXSettings: userDetail.freepbxSettings?.enabled || false,
          hasTwilioSettings: Boolean(userDetail.twilioSettings),
        };
      }));

      console.log(`✅ Found ${enhancedUsers.length} users`);
      
      res.json({
        success: true,
        data: enhancedUsers,
      });
    } catch (error) {
      console.error('❌ Error fetching users:', error.message);
      logger.error({ error: error.message }, 'Error fetching users');
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/users/:userId
   * Get specific user details
   */
  static async getUser(req, res, next) {
    try {
      const { userId } = req.params;
      
      console.log(`\n👤 Admin fetching user: ${userId}`);
      
      const user = await User.findById(userId);
      
      // Get call count
      const callCountResult = await query(
        'SELECT COUNT(*) as count FROM calls WHERE user_id = $1',
        [userId]
      );
      
      const enhancedUser = {
        ...user,
        callCount: parseInt(callCountResult.rows[0].count, 10),
      };
      
      console.log(`✅ Found user: ${user.email}`);
      
      res.json({
        success: true,
        data: enhancedUser,
      });
    } catch (error) {
      console.error('❌ Error fetching user:', error.message);
      logger.error({ error: error.message, userId: req.params.userId }, 'Error fetching user');
      next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/users/:userId/role
   * Update user role
   */
  static async updateUserRole(req, res, next) {
    try {
      const { userId } = req.params;
      const { role } = req.body;
      
      console.log(`\n🔧 Admin updating role for user: ${userId} to ${role}`);
      
      if (!role || !['admin', 'user'].includes(role)) {
        throw new BadRequestError('Invalid role. Must be "admin" or "user"');
      }
      
      // Prevent admin from demoting themselves
      if (userId === req.user.id) {
        throw new BadRequestError('You cannot change your own role');
      }

      // Prevent changing super admin role
      const targetUser = await User.findById(userId);
      if (targetUser.role === 'super_admin') {
        throw new BadRequestError('You cannot change the role of a Super Admin');
      }
      
      const user = await User.updateRole(userId, role);
      
      console.log(`✅ Updated user role: ${user.email} -> ${role}`);
      logger.info({ 
        adminId: req.user.id, 
        targetUserId: userId, 
        newRole: role 
      }, 'Admin updated user role');
      
      res.json({
        success: true,
        data: user,
        message: `User role updated to ${role}`,
      });
    } catch (error) {
      console.error('❌ Error updating user role:', error.message);
      logger.error({ 
        error: error.message, 
        userId: req.params.userId, 
        adminId: req.user?.id 
      }, 'Error updating user role');
      next(error);
    }
  }

  /**
   * GET /api/v1/admin/users/:userId/calls
   * Get calls for specific user (admin access)
   */
  static async getUserCalls(req, res, next) {
    try {
      const { userId } = req.params;
      const { limit = 50, offset = 0, status } = req.query;
      
      console.log(`\n📞 Admin fetching calls for user: ${userId}`);
      
      const calls = await Call.findByUserId(userId, {
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        status,
      });
      
      console.log(`✅ Found ${calls.length} calls for user ${userId}`);
      logger.info({ 
        adminId: req.user.id, 
        targetUserId: userId, 
        callCount: calls.length 
      }, 'Admin accessed user calls');
      
      res.json({
        success: true,
        data: calls,
        pagination: {
          limit: parseInt(limit, 10),
          offset: parseInt(offset, 10),
          count: calls.length,
        },
      });
    } catch (error) {
      console.error('❌ Error fetching user calls:', error.message);
      logger.error({ 
        error: error.message, 
        userId: req.params.userId,
        adminId: req.user?.id 
      }, 'Error fetching user calls');
      next(error);
    }
  }

  /**
   * DELETE /api/v1/admin/users/:userId
   * Delete a user (removes from both Supabase Auth and database)
   */
  static async deleteUser(req, res, next) {
    try {
      const { userId } = req.params;
      
      console.log(`\n🗑️  Admin deleting user: ${userId}`);
      
      // Prevent admin from deleting themselves
      if (userId === req.user.id) {
        throw new BadRequestError('You cannot delete your own account');
      }
      
      // Prevent deleting super admin accounts
      const targetUser = await User.findById(userId);
      if (targetUser.role === 'super_admin') {
        throw new BadRequestError('You cannot delete a Super Admin account');
      }
      
      // Get user info before deletion (for logging)
      const user = targetUser;
      
      // Delete all calls associated with this user first
      console.log(`🗑️  Deleting all calls for user: ${user.email}`);
      const callDeleteResult = await query('DELETE FROM calls WHERE user_id = $1', [userId]);
      const deletedCallCount = callDeleteResult.rowCount || 0;
      console.log(`✅ Deleted ${deletedCallCount} calls for user: ${user.email}`);
      logger.info({ userId, deletedCallCount }, 'Deleted user calls');
      
      // Try to delete from Supabase Auth first
      const supabaseAdmin = getSupabaseAdmin();
      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
      
      if (deleteError) {
        // If user doesn't exist in Supabase Auth, that's okay - they might be orphaned
        // Just delete from our database
        if (deleteError.status === 404 || deleteError.code === 'user_not_found') {
          console.log(`⚠️  User not found in Supabase Auth (orphaned user), deleting from database only`);
          logger.warn({ userId }, 'User not found in Supabase Auth, deleting from database only');
          
          // Delete from database (since trigger won't fire)
          await query('DELETE FROM users WHERE id = $1', [userId]);
        } else {
          // Other errors should fail
          logger.error({ error: deleteError, userId }, 'Error deleting user from Supabase Auth');
          throw new Error(`Failed to delete user: ${deleteError.message}`);
        }
      } else {
        console.log(`✅ Deleted user from Supabase Auth (database deletion will follow via trigger)`);
      }
      
      console.log(`✅ Deleted user: ${user.email}`);
      logger.info({ 
        adminId: req.user.id, 
        deletedUserId: userId, 
        deletedUserEmail: user.email 
      }, 'Admin deleted user');
      
      res.json({
        success: true,
        message: `User ${user.email} and ${deletedCallCount} associated calls have been deleted`,
      });
    } catch (error) {
      console.error('❌ Error deleting user:', error.message);
      logger.error({ 
        error: error.message, 
        userId: req.params.userId,
        adminId: req.user?.id 
      }, 'Error deleting user');
      next(error);
    }
  }

  /**
   * POST /api/v1/admin/users
   * Create a new user (Supabase Auth + public.users)
   *
   * Body:
   *  - email
   *  - password
   *  - role: 'admin' | 'user'
   *  - canUseApp: boolean
   *  - canUseFreepbxManager: boolean
   */
  static async createUser(req, res, next) {
    try {
      const { email, password, role, canUseApp, canUseFreepbxManager } = req.body || {};

      if (!email || typeof email !== 'string') {
        throw new BadRequestError('email is required');
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        throw new BadRequestError('password is required (min 8 chars)');
      }
      if (!role || !['admin', 'user'].includes(role)) {
        throw new BadRequestError('role must be "admin" or "user"');
      }

      const resolvedCanUseApp = canUseApp !== false;
      const resolvedCanUseFreepbxManager = canUseFreepbxManager === true;

      const supabaseAdmin = getSupabaseAdmin();
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (error) {
        throw new BadRequestError(error.message || 'Failed to create auth user');
      }

      const created = data?.user;
      if (!created?.id) {
        throw new Error('Supabase createUser did not return an id');
      }

      // Ensure public.users has role + capability fields set (trigger may already have created the row)
      await query(
        `INSERT INTO users (
          id,
          email,
          role,
          can_use_app,
          can_use_freepbx_manager,
          subscription_tier,
          timezone,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'free', 'UTC', NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          role = EXCLUDED.role,
          can_use_app = EXCLUDED.can_use_app,
          can_use_freepbx_manager = EXCLUDED.can_use_freepbx_manager,
          updated_at = NOW()`,
        [created.id, email, role, resolvedCanUseApp, resolvedCanUseFreepbxManager]
      );

      const user = await User.findById(created.id);

      res.status(201).json({
        success: true,
        data: user,
        message: 'User created successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/v1/admin/users/:userId/access
   * Update capability flags (Super Admin only).
   */
  static async updateUserAccess(req, res, next) {
    try {
      const { userId } = req.params;
      const { canUseApp, canUseFreepbxManager } = req.body || {};

      if (userId === req.user.id) {
        throw new BadRequestError('You cannot change your own access flags');
      }

      const targetUser = await User.findById(userId);
      if (targetUser.role === 'super_admin') {
        throw new BadRequestError('You cannot change access flags for a Super Admin');
      }

      const updates = {};
      if (typeof canUseApp === 'boolean') updates.canUseApp = canUseApp;
      if (typeof canUseFreepbxManager === 'boolean') updates.canUseFreepbxManager = canUseFreepbxManager;

      if (Object.keys(updates).length === 0) {
        throw new BadRequestError('No valid fields to update');
      }

      const updated = await User.update(userId, updates);

      res.json({
        success: true,
        data: updated,
        message: 'User access updated',
      });
    } catch (error) {
      next(error);
    }
  }
}

