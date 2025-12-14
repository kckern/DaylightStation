/**
 * Tests for Logging modules
 * @group Phase1
 */

import { Logger, createLogger, LOG_LEVELS } from '../../_lib/logging/Logger.mjs';

describe('Phase1: Logger', () => {
  let outputs;
  let mockOutput;

  beforeEach(() => {
    outputs = [];
    mockOutput = (msg) => outputs.push(msg);
  });

  describe('LOG_LEVELS', () => {
    it('should have correct severity order', () => {
      expect(LOG_LEVELS.error).toBeLessThan(LOG_LEVELS.warn);
      expect(LOG_LEVELS.warn).toBeLessThan(LOG_LEVELS.info);
      expect(LOG_LEVELS.info).toBeLessThan(LOG_LEVELS.debug);
    });
  });

  describe('Logger construction', () => {
    it('should create with defaults', () => {
      const logger = new Logger();
      expect(logger.source).toBe('chatbot');
      expect(logger.app).toBe('unknown');
      expect(logger.level).toBe(LOG_LEVELS.info);
    });

    it('should accept custom options', () => {
      const logger = new Logger({
        level: 'debug',
        source: 'nutribot',
        app: 'webhook',
      });
      
      expect(logger.level).toBe(LOG_LEVELS.debug);
      expect(logger.source).toBe('nutribot');
      expect(logger.app).toBe('webhook');
    });
  });

  describe('Logging methods', () => {
    it('should log at correct levels', () => {
      const logger = new Logger({ level: 'debug', output: mockOutput });
      
      logger.error('test.error', { data: 'error' });
      logger.warn('test.warn', { data: 'warn' });
      logger.info('test.info', { data: 'info' });
      logger.debug('test.debug', { data: 'debug' });
      
      expect(outputs).toHaveLength(4);
    });

    it('should filter logs below threshold', () => {
      const logger = new Logger({ level: 'warn', output: mockOutput });
      
      logger.error('test.error');
      logger.warn('test.warn');
      logger.info('test.info'); // Should be filtered
      logger.debug('test.debug'); // Should be filtered
      
      expect(outputs).toHaveLength(2);
    });

    it('should output valid JSON', () => {
      const logger = new Logger({ output: mockOutput });
      logger.info('test.event', { key: 'value' });
      
      const parsed = JSON.parse(outputs[0]);
      expect(parsed.event).toBe('test.event');
      expect(parsed.key).toBe('value');
      expect(parsed.level).toBe('info');
    });

    it('should include timestamp', () => {
      const logger = new Logger({ output: mockOutput });
      logger.info('test.event');
      
      const parsed = JSON.parse(outputs[0]);
      expect(parsed.ts).toBeDefined();
      expect(() => new Date(parsed.ts)).not.toThrow();
    });
  });

  describe('Error logging', () => {
    it('should extract Error properties', () => {
      const logger = new Logger({ output: mockOutput });
      const error = new Error('Test error');
      
      logger.error('test.error', error);
      
      const parsed = JSON.parse(outputs[0]);
      expect(parsed.message).toBe('Test error');
      expect(parsed.name).toBe('Error');
      expect(parsed.stack).toBeDefined();
    });

    it('should include error context', () => {
      const logger = new Logger({ output: mockOutput });
      const error = new Error('Test error');
      error.context = { userId: '123' };
      
      logger.error('test.error', error);
      
      const parsed = JSON.parse(outputs[0]);
      expect(parsed.userId).toBe('123');
    });
  });

  describe('Redaction', () => {
    it('should redact sensitive fields', () => {
      const logger = new Logger({ output: mockOutput });
      
      logger.info('test.event', {
        token: 'secret-token',
        apiKey: 'secret-key',
        normalData: 'visible',
      });
      
      const parsed = JSON.parse(outputs[0]);
      expect(parsed.token).toBe('[REDACTED]');
      expect(parsed.apiKey).toBe('[REDACTED]');
      expect(parsed.normalData).toBe('visible');
    });

    it('should redact nested fields', () => {
      const logger = new Logger({ output: mockOutput });
      
      logger.info('test.event', {
        nested: { password: 'secret' },
      });
      
      const parsed = JSON.parse(outputs[0]);
      expect(parsed.nested.password).toBe('[REDACTED]');
    });

    it('should support custom redact fields', () => {
      const logger = new Logger({ 
        output: mockOutput,
        redactFields: ['customSecret'],
      });
      
      logger.info('test.event', { customSecret: 'hidden' });
      
      const parsed = JSON.parse(outputs[0]);
      expect(parsed.customSecret).toBe('[REDACTED]');
    });
  });

  describe('Default context', () => {
    it('should include default context in all logs', () => {
      const logger = new Logger({ output: mockOutput });
      logger.setDefaultContext({ requestId: 'req-123' });
      
      logger.info('test.event');
      
      const parsed = JSON.parse(outputs[0]);
      expect(parsed.requestId).toBe('req-123');
    });

    it('should allow chaining setDefaultContext', () => {
      const logger = new Logger({ output: mockOutput });
      const result = logger.setDefaultContext({ a: 1 });
      
      expect(result).toBe(logger);
    });
  });

  describe('Child logger', () => {
    it('should inherit settings from parent', () => {
      const parent = new Logger({ 
        level: 'debug', 
        source: 'parent',
        output: mockOutput,
      });
      parent.setDefaultContext({ parentContext: 'value' });
      
      const child = parent.child({ childContext: 'child-value' });
      child.info('test.event');
      
      const parsed = JSON.parse(outputs[0]);
      expect(parsed.source).toBe('parent');
      expect(parsed.parentContext).toBe('value');
      expect(parsed.childContext).toBe('child-value');
    });
  });

  describe('createLogger', () => {
    it('should create Logger instance', () => {
      const logger = createLogger({ source: 'test' });
      expect(logger).toBeInstanceOf(Logger);
      expect(logger.source).toBe('test');
    });
  });
});
