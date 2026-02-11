import { UnauthorizedError, ForbiddenError } from '../utils/errors.js';
import { User } from '../models/User.js';

/**
 * Require access to core app functionality (Dashboard/Calls/etc).
 * Super Admin always allowed.
 */
export async function requireAppAccess(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('Authentication required');
    }

    const authContext = (typeof req.user.canUseApp === 'boolean' && req.user.role)
      ? req.user
      : await User.getAuthContext(req.user.id);

    const allowed = authContext?.role === 'super_admin' || authContext?.canUseApp !== false;
    if (!allowed) {
      throw new ForbiddenError('App access required');
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

