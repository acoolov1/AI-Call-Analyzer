import { getPool, query } from '../config/database.js';

export { getPool, query };

// Re-export models
export * from './Call.js';
export * from './User.js';

