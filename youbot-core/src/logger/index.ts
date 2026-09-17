/**
 * Logger Module
 */

import type { LoggerInstance, LoggerConfig } from './types.js';

let logger: LoggerInstance | null = null;

/**
 * Create a default console logger
 */
function createDefaultLogger(config?: LoggerConfig): LoggerInstance {
  const prefix = config?.prefix ?? '[youbot]';
  const level = config?.level ?? 'info';
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const currentLevel = levels[level];

  return {
    debug: (message: string, ...args: unknown[]) => {
      if (currentLevel <= levels.debug) {
        console.debug(`${prefix} DEBUG:`, message, ...args);
      }
    },
    info: (message: string, ...args: unknown[]) => {
      if (currentLevel <= levels.info) {
        console.info(`${prefix} INFO:`, message, ...args);
      }
    },
    warn: (message: string, ...args: unknown[]) => {
      if (currentLevel <= levels.warn) {
        console.warn(`${prefix} WARN:`, message, ...args);
      }
    },
    error: (message: string, ...args: unknown[]) => {
      if (currentLevel <= levels.error) {
        console.error(`${prefix} ERROR:`, message, ...args);
      }
    },
  };
}

/**
 * Get the logger instance
 */
export function getLogger(): LoggerInstance {
  if (!logger) {
    logger = createDefaultLogger();
  }
  return logger;
}

/**
 * Set a custom logger instance
 */
export function setLogger(customLogger: LoggerInstance): void {
  logger = customLogger;
}

/**
 * Initialize logger with config
 */
export function initializeLogger(config?: LoggerConfig): LoggerInstance {
  logger = createDefaultLogger(config);
  return logger;
}

/**
 * Reset the logger
 */
export function resetLogger(): void {
  logger = null;
}

/**
 * Alias for initializeLogger (backwards compatibility)
 */
export const createLogger = initializeLogger;

export type { LoggerInstance, LoggerConfig } from './types.js';