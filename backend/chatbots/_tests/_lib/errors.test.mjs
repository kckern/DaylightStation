/**
 * Tests for Error modules
 * @group Phase1
 */

import {
  DomainError,
  ValidationError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  isDomainError,
  isValidationError,
  isNotFoundError,
} from '../../_lib/errors/DomainError.mjs';

import {
  InfrastructureError,
  ExternalServiceError,
  RateLimitError,
  PersistenceError,
  TimeoutError,
  isInfrastructureError,
  isRetryableError,
  isRateLimitError,
} from '../../_lib/errors/InfrastructureError.mjs';

import { getHttpStatus, wrapError } from '../../_lib/errors/index.mjs';

describe('Phase1: DomainError', () => {
  describe('DomainError base class', () => {
    it('should create error with message', () => {
      const error = new DomainError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('DomainError');
    });

    it('should include context', () => {
      const error = new DomainError('Test error', { userId: '123' });
      expect(error.context).toEqual({ userId: '123' });
    });

    it('should have timestamp', () => {
      const error = new DomainError('Test error');
      expect(error.timestamp).toBeDefined();
      expect(() => new Date(error.timestamp)).not.toThrow();
    });

    it('should have default httpStatus 500', () => {
      const error = new DomainError('Test error');
      expect(error.httpStatus).toBe(500);
    });

    it('should serialize to JSON', () => {
      const error = new DomainError('Test error', { key: 'value' });
      const json = error.toJSON();
      
      expect(json.name).toBe('DomainError');
      expect(json.message).toBe('Test error');
      expect(json.context).toEqual({ key: 'value' });
      expect(json.httpStatus).toBe(500);
    });
  });

  describe('ValidationError', () => {
    it('should have httpStatus 400', () => {
      const error = new ValidationError('Invalid input');
      expect(error.httpStatus).toBe(400);
      expect(error.name).toBe('ValidationError');
    });

    it('should create from Zod-like error', () => {
      const zodError = {
        issues: [
          { path: ['field1'], message: 'Required', code: 'required' },
          { path: ['nested', 'field'], message: 'Invalid', code: 'invalid' },
        ],
      };
      
      const error = ValidationError.fromZodError(zodError);
      expect(error.context.issues).toHaveLength(2);
      expect(error.context.issues[0].path).toBe('field1');
      expect(error.context.issues[1].path).toBe('nested.field');
    });
  });

  describe('NotFoundError', () => {
    it('should have httpStatus 404', () => {
      const error = new NotFoundError('User', '123');
      expect(error.httpStatus).toBe(404);
      expect(error.message).toBe('User not found: 123');
    });

    it('should include entity type and identifier in context', () => {
      const error = new NotFoundError('NutriLog', 'uuid-123');
      expect(error.context.entityType).toBe('NutriLog');
      expect(error.context.identifier).toBe('uuid-123');
    });
  });

  describe('ConflictError', () => {
    it('should have httpStatus 409', () => {
      const error = new ConflictError('Duplicate entry');
      expect(error.httpStatus).toBe(409);
      expect(error.name).toBe('ConflictError');
    });
  });

  describe('BusinessRuleError', () => {
    it('should have httpStatus 422', () => {
      const error = new BusinessRuleError('MAX_ITEMS', 'Cannot exceed 10 items');
      expect(error.httpStatus).toBe(422);
      expect(error.rule).toBe('MAX_ITEMS');
      expect(error.context.rule).toBe('MAX_ITEMS');
    });
  });

  describe('isDomainError helper', () => {
    it('should return true for domain errors', () => {
      expect(isDomainError(new DomainError('test'))).toBe(true);
      expect(isDomainError(new ValidationError('test'))).toBe(true);
      expect(isDomainError(new NotFoundError('type', 'id'))).toBe(true);
    });

    it('should return false for non-domain errors', () => {
      expect(isDomainError(new Error('test'))).toBe(false);
      expect(isDomainError(null)).toBe(false);
    });
  });

  describe('isValidationError helper', () => {
    it('should identify validation errors', () => {
      expect(isValidationError(new ValidationError('test'))).toBe(true);
      expect(isValidationError(new DomainError('test'))).toBe(false);
    });
  });

  describe('isNotFoundError helper', () => {
    it('should identify not found errors', () => {
      expect(isNotFoundError(new NotFoundError('type', 'id'))).toBe(true);
      expect(isNotFoundError(new DomainError('test'))).toBe(false);
    });
  });
});

describe('Phase1: InfrastructureError', () => {
  describe('InfrastructureError base class', () => {
    it('should create error with message and context', () => {
      const error = new InfrastructureError('Test error', { service: 'test' });
      expect(error.message).toBe('Test error');
      expect(error.context.service).toBe('test');
      expect(error.retryable).toBe(false);
    });
  });

  describe('ExternalServiceError', () => {
    it('should have httpStatus 502', () => {
      const error = new ExternalServiceError('Telegram', 'API failed');
      expect(error.httpStatus).toBe(502);
      expect(error.service).toBe('Telegram');
      expect(error.retryable).toBe(true);
    });

    it('should create from Axios-like error', () => {
      const axiosError = {
        response: {
          status: 500,
          statusText: 'Internal Server Error',
          data: { error: 'Server error' },
        },
        config: {
          url: 'https://api.example.com',
          method: 'POST',
        },
        message: 'Request failed',
      };
      
      const error = ExternalServiceError.fromAxiosError('TestAPI', axiosError);
      expect(error.context.statusCode).toBe(500);
      expect(error.context.url).toBe('https://api.example.com');
    });
  });

  describe('RateLimitError', () => {
    it('should have httpStatus 429', () => {
      const error = new RateLimitError('OpenAI', 30);
      expect(error.httpStatus).toBe(429);
      expect(error.retryAfter).toBe(30);
      expect(error.retryable).toBe(true);
    });

    it('should work without retryAfter', () => {
      const error = new RateLimitError('Telegram');
      expect(error.retryAfter).toBeNull();
    });
  });

  describe('PersistenceError', () => {
    it('should have httpStatus 500', () => {
      const error = new PersistenceError('write', 'Disk full');
      expect(error.httpStatus).toBe(500);
      expect(error.operation).toBe('write');
      expect(error.retryable).toBe(false); // writes not retryable
    });

    it('should be retryable for read operations', () => {
      const error = new PersistenceError('read', 'Timeout');
      expect(error.retryable).toBe(true);
    });
  });

  describe('TimeoutError', () => {
    it('should have httpStatus 504', () => {
      const error = new TimeoutError('API call', 5000);
      expect(error.httpStatus).toBe(504);
      expect(error.timeoutMs).toBe(5000);
      expect(error.retryable).toBe(true);
    });
  });

  describe('isInfrastructureError helper', () => {
    it('should identify infrastructure errors', () => {
      expect(isInfrastructureError(new InfrastructureError('test'))).toBe(true);
      expect(isInfrastructureError(new ExternalServiceError('svc', 'msg'))).toBe(true);
      expect(isInfrastructureError(new Error('test'))).toBe(false);
    });
  });

  describe('isRetryableError helper', () => {
    it('should identify retryable errors', () => {
      expect(isRetryableError(new RateLimitError('svc'))).toBe(true);
      expect(isRetryableError(new TimeoutError('op', 1000))).toBe(true);
      expect(isRetryableError(new PersistenceError('write', 'fail'))).toBe(false);
    });
  });
});

describe('Phase1: Error helpers', () => {
  describe('getHttpStatus', () => {
    it('should return httpStatus from error', () => {
      expect(getHttpStatus(new ValidationError('test'))).toBe(400);
      expect(getHttpStatus(new NotFoundError('type', 'id'))).toBe(404);
      expect(getHttpStatus(new RateLimitError('svc'))).toBe(429);
    });

    it('should return 500 for unknown errors', () => {
      expect(getHttpStatus(new Error('test'))).toBe(500);
      expect(getHttpStatus(null)).toBe(500);
    });
  });

  describe('wrapError', () => {
    it('should add context to error', () => {
      const error = new DomainError('test', { existing: 'value' });
      wrapError(error, { added: 'context' });
      
      expect(error.context.existing).toBe('value');
      expect(error.context.added).toBe('context');
    });

    it('should create context if not exists', () => {
      const error = new Error('test');
      wrapError(error, { added: 'context' });
      
      expect(error.context.added).toBe('context');
    });
  });
});
