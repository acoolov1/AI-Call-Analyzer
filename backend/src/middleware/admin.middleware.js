import { User } from '../models/User.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Middleware to require Super Admin role.
 */
export async function requireSuperAdmin(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const role = req.user.role || (await User.getAuthContext(req.user.id))?.role;
    if (role !== 'super_admin') {
      logger.warn({ userId: req.user.id, role }, 'Non-super-admin user attempted to access super-admin endpoint');
      throw new ForbiddenError('Super Admin access required');
    }

    req.user.role = 'super_admin';
    req.user.isAdmin = true;
    req.user.canUseApp = true;
    req.user.canUseFreepbxManager = true;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to require FreePBX Manager read access.
 * Allowed if:
 *  - role is super_admin, OR
 *  - canUseFreepbxManager capability is enabled
 */
export async function requireFreepbxAccess(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const authContext = (req.user.role && typeof req.user.canUseFreepbxManager === 'boolean')
      ? req.user
      : await User.getAuthContext(req.user.id);

    const allowed = authContext?.role === 'super_admin' || authContext?.canUseFreepbxManager === true;
    if (!allowed) {
      logger.warn({ userId: req.user.id, role: authContext?.role }, 'User attempted to access FreePBX Manager without permission');
      throw new ForbiddenError('FreePBX Manager access required');
    }

    req.user.role = authContext?.role || req.user.role || 'user';
    req.user.isAdmin = authContext?.isAdmin === true;
    req.user.canUseApp = authContext?.canUseApp !== false;
    req.user.canUseFreepbxManager = authContext?.canUseFreepbxManager === true;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to require FreePBX Manager write access (mutations).
 * For now: Super Admin only.
 */
export async function requireFreepbxWrite(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const role = req.user.role || (await User.getAuthContext(req.user.id))?.role;
    if (role !== 'super_admin') {
      throw new ForbiddenError('Super Admin access required');
    }

    req.user.role = 'super_admin';
    req.user.isAdmin = true;
    req.user.canUseApp = true;
    req.user.canUseFreepbxManager = true;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to optionally attach role/capabilities.
 */
export async function optionalAdmin(req, res, next) {
  try {
    if (req.user && req.user.id) {
      const authContext = await User.getAuthContext(req.user.id);
      if (authContext) {
        req.user.role = authContext.role;
        req.user.isAdmin = authContext.isAdmin;
        req.user.canUseApp = authContext.canUseApp;
        req.user.canUseFreepbxManager = authContext.canUseFreepbxManager;
      }
    }
    next();
  } catch (error) {
    logger.error({ error: error.message, userId: req.user?.id }, 'Error attaching user auth context');
    next();
  }
}

