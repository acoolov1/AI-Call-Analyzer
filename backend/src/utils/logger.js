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

// NOTE: Avoid startup "test" logs and banners to keep production logs clean.

// Helper to create child logger with context (for compatibility)
export function createLogger(context = {}) {
  return logger;
}
