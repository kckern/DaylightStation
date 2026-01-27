import { describe, it, expect } from 'vitest';
import {
  InfrastructureError,
  ExternalServiceError,
  RateLimitError,
  PersistenceError,
  TimeoutError,
} from '../../../../../../src/0_system/utils/errors/InfrastructureError.mjs';

describe('InfrastructureError', () => {
  describe('code property', () => {
    it('should have code from context', () => {
      const error = new InfrastructureError('test message', { code: 'TEST_CODE' });
      expect(error.code).toBe('TEST_CODE');
    });

    it('should default to INFRASTRUCTURE_ERROR when no code provided', () => {
      const error = new InfrastructureError('test message');
      expect(error.code).toBe('INFRASTRUCTURE_ERROR');
    });

    it('should default to INFRASTRUCTURE_ERROR when context has no code', () => {
      const error = new InfrastructureError('test message', { someField: 'value' });
      expect(error.code).toBe('INFRASTRUCTURE_ERROR');
    });

    it('should include code in toJSON output', () => {
      const error = new InfrastructureError('test', { code: 'MY_CODE' });
      const json = error.toJSON();
      expect(json.code).toBe('MY_CODE');
    });

    it('should include default code in toJSON output', () => {
      const error = new InfrastructureError('test');
      const json = error.toJSON();
      expect(json.code).toBe('INFRASTRUCTURE_ERROR');
    });
  });
});

describe('ExternalServiceError', () => {
  describe('code property', () => {
    it('should have code from context', () => {
      const error = new ExternalServiceError('Plex', 'connection failed', { code: 'PLEX_CONNECTION_FAILED' });
      expect(error.code).toBe('PLEX_CONNECTION_FAILED');
    });

    it('should default to EXTERNAL_SERVICE_ERROR when no code provided', () => {
      const error = new ExternalServiceError('Plex', 'connection failed');
      expect(error.code).toBe('EXTERNAL_SERVICE_ERROR');
    });

    it('should include code in toJSON output', () => {
      const error = new ExternalServiceError('Plex', 'connection failed', { code: 'API_UNAVAILABLE' });
      const json = error.toJSON();
      expect(json.code).toBe('API_UNAVAILABLE');
    });

    it('should include default code in toJSON output', () => {
      const error = new ExternalServiceError('Plex', 'connection failed');
      const json = error.toJSON();
      expect(json.code).toBe('EXTERNAL_SERVICE_ERROR');
    });

    it('should still have service property accessible', () => {
      const error = new ExternalServiceError('Plex', 'connection failed');
      expect(error.service).toBe('Plex');
    });
  });
});

describe('RateLimitError', () => {
  describe('code property', () => {
    it('should have code from context', () => {
      const error = new RateLimitError('OpenAI', 60, { code: 'OPENAI_RATE_LIMIT' });
      expect(error.code).toBe('OPENAI_RATE_LIMIT');
    });

    it('should default to RATE_LIMIT_EXCEEDED when no code provided', () => {
      const error = new RateLimitError('OpenAI', 60);
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should default to RATE_LIMIT_EXCEEDED when context has no code', () => {
      const error = new RateLimitError('OpenAI', null, { attempts: 3 });
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should include code in toJSON output', () => {
      const error = new RateLimitError('OpenAI', 60, { code: 'QUOTA_EXCEEDED' });
      const json = error.toJSON();
      expect(json.code).toBe('QUOTA_EXCEEDED');
    });

    it('should include default code in toJSON output', () => {
      const error = new RateLimitError('OpenAI', 60);
      const json = error.toJSON();
      expect(json.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should still have service and retryAfter properties accessible', () => {
      const error = new RateLimitError('OpenAI', 60);
      expect(error.service).toBe('OpenAI');
      expect(error.retryAfter).toBe(60);
    });
  });
});

describe('PersistenceError', () => {
  describe('code property', () => {
    it('should have code from context', () => {
      const error = new PersistenceError('write', 'disk full', { code: 'DISK_FULL' });
      expect(error.code).toBe('DISK_FULL');
    });

    it('should default to PERSISTENCE_ERROR when no code provided', () => {
      const error = new PersistenceError('write', 'disk full');
      expect(error.code).toBe('PERSISTENCE_ERROR');
    });

    it('should include code in toJSON output', () => {
      const error = new PersistenceError('write', 'permission denied', { code: 'PERMISSION_DENIED' });
      const json = error.toJSON();
      expect(json.code).toBe('PERMISSION_DENIED');
    });

    it('should include default code in toJSON output', () => {
      const error = new PersistenceError('write', 'disk full');
      const json = error.toJSON();
      expect(json.code).toBe('PERSISTENCE_ERROR');
    });

    it('should still have operation property accessible', () => {
      const error = new PersistenceError('write', 'disk full');
      expect(error.operation).toBe('write');
    });
  });
});

describe('TimeoutError', () => {
  describe('code property', () => {
    it('should have code from context', () => {
      const error = new TimeoutError('database query', 5000, { code: 'DB_TIMEOUT' });
      expect(error.code).toBe('DB_TIMEOUT');
    });

    it('should default to TIMEOUT when no code provided', () => {
      const error = new TimeoutError('database query', 5000);
      expect(error.code).toBe('TIMEOUT');
    });

    it('should include code in toJSON output', () => {
      const error = new TimeoutError('API call', 10000, { code: 'API_TIMEOUT' });
      const json = error.toJSON();
      expect(json.code).toBe('API_TIMEOUT');
    });

    it('should include default code in toJSON output', () => {
      const error = new TimeoutError('API call', 10000);
      const json = error.toJSON();
      expect(json.code).toBe('TIMEOUT');
    });

    it('should still have operation and timeoutMs properties accessible', () => {
      const error = new TimeoutError('database query', 5000);
      expect(error.operation).toBe('database query');
      expect(error.timeoutMs).toBe(5000);
    });
  });
});
