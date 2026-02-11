import { UnauthorizedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { User } from '../models/User.js';

export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('No token provided');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // TODO: Verify JWT token with Supabase
    // For now, we'll extract user ID from token
    // In production, use Supabase JWT verification
    
    // Decode token to get user ID
    // NextAuth sends a JWT token, we need to extract the user ID
    try {
      const parts = token.split('.');
      
      // Try to decode the payload (second part)
      let payload;
      if (parts.length >= 2) {
        // Decode base64 payload
        const decoded = Buffer.from(parts[1], 'base64').toString();
        payload = JSON.parse(decoded);
      } else {
        // If not a standard JWT, try to parse as JSON directly
        payload = JSON.parse(Buffer.from(token, 'base64').toString());
      }
      
      // Extract user ID from token
      // NextAuth stores user.id in token.id
      const userId = payload.id || payload.sub || payload.user_id || payload.userId;
      
      if (!userId) {
        throw new UnauthorizedError('No user ID in token');
      }
      
      // Fetch role + capability flags from database
      const authContext = await User.getAuthContext(userId);

      // If the DB row hasn't been created yet (e.g. trigger lag), default to a safe baseline.
      req.user = authContext || {
        id: userId,
        role: 'user',
        isAdmin: false,
        canUseApp: true,
        canUseFreepbxManager: false,
      };
    } catch (err) {
      logger.warn({ error: err.message }, 'Token decode/parse failed');
      throw new UnauthorizedError('Invalid token: ' + err.message);
    }

    next();
  } catch (error) {
    logger.warn({ error: error.message }, 'Authentication error');
    next(error);
  }
}

// Optional: Extract user from session (if using session-based auth)
export function optionalAuth(req, res, next) {
  try {
    authenticate(req, res, () => {
      // If auth fails, continue without user
      next();
    });
  } catch (error) {
    // Continue without authentication
    next();
  }
}

