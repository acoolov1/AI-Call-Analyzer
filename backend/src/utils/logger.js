// Simple logger that ALWAYS outputs to console - no pino, no transport issues
// This ensures debug output is always visible and real-time
// Just passes everything directly to console.log for immediate output

const createLoggerInstance = () => {
  return {
    trace: (...args) => console.log('[TRACE]', ...args),
    debug: (...args) => console.log('[DEBUG]', ...args),
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    fatal: (...args) => console.error('[FATAL]', ...args),
    child: () => createLoggerInstance(),
  };
};

// Use simple logger - always works, always visible
export const logger = createLoggerInstance();

// Log startup info - always show
console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`🔍 DEBUG MODE ENABLED - SIMPLE LOGGER`);
console.log(`🔍 All logs will be shown directly to console`);
console.log(`═══════════════════════════════════════════════════════════\n`);

// Test logging
logger.info('Logger test: INFO message');
logger.debug('Logger test: DEBUG message');
logger.trace('Logger test: TRACE message');
console.log('Console.log test: This should always be visible\n');

// Helper to create child logger with context (for compatibility)
export function createLogger(context = {}) {
  return logger;
}
