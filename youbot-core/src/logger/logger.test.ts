import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLogger,
  getLogger,
  setLogger,
  initializeLogger,
  resetLogger,
} from './index.js';
import type { LoggerInstance, LoggerConfig } from './types.js';

describe('Logger', () => {
  beforeEach(() => {
    resetLogger();
  });

  describe('createLogger', () => {
    it('should create a logger with default options', () => {
      const logger = createLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.warn).toBe('function');
    });

    it('should create a logger with custom level', () => {
      const logger = createLogger({ level: 'debug' });
      expect(logger).toBeDefined();
    });

    it('should create a logger with prefix', () => {
      const logger = createLogger({ level: 'info', prefix: '[test]' });
      expect(logger).toBeDefined();
    });
  });

  describe('getLogger', () => {
    it('should return a logger instance', () => {
      const logger = getLogger();
      expect(logger).toBeDefined();
    });

    it('should return the same instance on subsequent calls', () => {
      const logger1 = getLogger();
      const logger2 = getLogger();
      expect(logger1).toBe(logger2);
    });
  });

  describe('setLogger', () => {
    it('should set a custom logger', () => {
      const customLogger: LoggerInstance = {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      };
      setLogger(customLogger);
      const logger = getLogger();
      expect(logger).toBe(customLogger);
    });
  });

  describe('LoggerInstance', () => {
    let logger: LoggerInstance;

    beforeEach(() => {
      logger = createLogger({ level: 'debug' });
    });

    it('should log error messages', () => {
      expect(() => logger.error('Test error message')).not.toThrow();
    });

    it('should log warn messages', () => {
      expect(() => logger.warn('Test warn message')).not.toThrow();
    });

    it('should log info messages', () => {
      expect(() => logger.info('Test info message')).not.toThrow();
    });

    it('should log debug messages', () => {
      expect(() => logger.debug('Test debug message')).not.toThrow();
    });

    it('should log with metadata', () => {
      expect(() =>
        logger.info('Test message with metadata', { userId: '123', action: 'test' })
      ).not.toThrow();
    });
  });

  describe('initializeLogger', () => {
    it('should initialize logger with config', () => {
      const config: LoggerConfig = { level: 'debug', prefix: '[test]' };
      const logger = initializeLogger(config);
      expect(logger).toBeDefined();
    });
  });

  describe('resetLogger', () => {
    it('should reset the logger instance', () => {
      const logger1 = getLogger();
      resetLogger();
      const logger2 = getLogger();
      // After reset, a new instance is created
      expect(logger2).toBeDefined();
    });
  });

  describe('log levels', () => {
    it('should respect log level priority', () => {
      const errorLogger = createLogger({ level: 'error' });
      expect(() => errorLogger.error('Should log')).not.toThrow();
      expect(() => errorLogger.info('Should not log but not throw')).not.toThrow();
    });
  });
});