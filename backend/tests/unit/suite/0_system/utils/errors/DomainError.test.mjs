import { describe, it, expect } from 'vitest';
import {
  DomainError,
  ValidationError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
} from '../../../../../../src/0_system/utils/errors/DomainError.mjs';

describe('DomainError', () => {
  describe('code property', () => {
    it('should have code from context', () => {
      const error = new DomainError('test message', { code: 'TEST_CODE' });
      expect(error.code).toBe('TEST_CODE');
    });

    it('should default to DOMAIN_ERROR when no code provided', () => {
      const error = new DomainError('test message');
      expect(error.code).toBe('DOMAIN_ERROR');
    });

    it('should default to DOMAIN_ERROR when context has no code', () => {
      const error = new DomainError('test message', { someField: 'value' });
      expect(error.code).toBe('DOMAIN_ERROR');
    });

    it('should include code in toJSON output', () => {
      const error = new DomainError('test', { code: 'MY_CODE' });
      const json = error.toJSON();
      expect(json.code).toBe('MY_CODE');
    });

    it('should include default code in toJSON output', () => {
      const error = new DomainError('test');
      const json = error.toJSON();
      expect(json.code).toBe('DOMAIN_ERROR');
    });
  });
});

describe('ValidationError', () => {
  describe('code property', () => {
    it('should have code from context', () => {
      const error = new ValidationError('invalid input', { code: 'CUSTOM_VALIDATION' });
      expect(error.code).toBe('CUSTOM_VALIDATION');
    });

    it('should default to VALIDATION_ERROR when no code provided', () => {
      const error = new ValidationError('invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should include code in toJSON output', () => {
      const error = new ValidationError('invalid input', { code: 'FIELD_REQUIRED' });
      const json = error.toJSON();
      expect(json.code).toBe('FIELD_REQUIRED');
    });

    it('should include default code in toJSON output', () => {
      const error = new ValidationError('invalid input');
      const json = error.toJSON();
      expect(json.code).toBe('VALIDATION_ERROR');
    });
  });
});

describe('NotFoundError', () => {
  describe('code property', () => {
    it('should have code from context (three-arg constructor)', () => {
      const error = new NotFoundError('User', '123', { code: 'USER_NOT_FOUND' });
      expect(error.code).toBe('USER_NOT_FOUND');
    });

    it('should default to NOT_FOUND when no code provided (three-arg constructor)', () => {
      const error = new NotFoundError('User', '123');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should default to NOT_FOUND when no code provided (single-arg constructor)', () => {
      const error = new NotFoundError('Entity not found');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should include code in toJSON output', () => {
      const error = new NotFoundError('User', '123', { code: 'CUSTOM_NOT_FOUND' });
      const json = error.toJSON();
      expect(json.code).toBe('CUSTOM_NOT_FOUND');
    });

    it('should include default code in toJSON output', () => {
      const error = new NotFoundError('User', '123');
      const json = error.toJSON();
      expect(json.code).toBe('NOT_FOUND');
    });
  });
});

describe('ConflictError', () => {
  describe('code property', () => {
    it('should have code from context', () => {
      const error = new ConflictError('duplicate entry', { code: 'DUPLICATE_KEY' });
      expect(error.code).toBe('DUPLICATE_KEY');
    });

    it('should default to CONFLICT when no code provided', () => {
      const error = new ConflictError('duplicate entry');
      expect(error.code).toBe('CONFLICT');
    });

    it('should include code in toJSON output', () => {
      const error = new ConflictError('duplicate entry', { code: 'CONCURRENT_EDIT' });
      const json = error.toJSON();
      expect(json.code).toBe('CONCURRENT_EDIT');
    });

    it('should include default code in toJSON output', () => {
      const error = new ConflictError('duplicate entry');
      const json = error.toJSON();
      expect(json.code).toBe('CONFLICT');
    });
  });
});

describe('BusinessRuleError', () => {
  describe('code property', () => {
    it('should have code from context', () => {
      const error = new BusinessRuleError('MAX_ITEMS', 'too many items', { code: 'ITEM_LIMIT_EXCEEDED' });
      expect(error.code).toBe('ITEM_LIMIT_EXCEEDED');
    });

    it('should default to BUSINESS_RULE_VIOLATION when no code provided', () => {
      const error = new BusinessRuleError('MAX_ITEMS', 'too many items');
      expect(error.code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('should include code in toJSON output', () => {
      const error = new BusinessRuleError('MAX_ITEMS', 'too many items', { code: 'QUOTA_EXCEEDED' });
      const json = error.toJSON();
      expect(json.code).toBe('QUOTA_EXCEEDED');
    });

    it('should include default code in toJSON output', () => {
      const error = new BusinessRuleError('MAX_ITEMS', 'too many items');
      const json = error.toJSON();
      expect(json.code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('should still have rule property accessible', () => {
      const error = new BusinessRuleError('MAX_ITEMS', 'too many items');
      expect(error.rule).toBe('MAX_ITEMS');
    });
  });
});
