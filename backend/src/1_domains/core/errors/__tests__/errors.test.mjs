import { describe, it, expect } from 'vitest';
import { ValidationError, DomainInvariantError, EntityNotFoundError } from '../index.mjs';

describe('ValidationError', () => {
  it('should include code, field, and value properties', () => {
    const error = new ValidationError('Duration must be positive', {
      code: 'INVALID_DURATION',
      field: 'duration',
      value: -5
    });

    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('Duration must be positive');
    expect(error.code).toBe('INVALID_DURATION');
    expect(error.field).toBe('duration');
    expect(error.value).toBe(-5);
  });
});

describe('DomainInvariantError', () => {
  it('should include code and details properties', () => {
    const error = new DomainInvariantError('Cannot complete inactive session', {
      code: 'SESSION_NOT_ACTIVE',
      details: { currentStatus: 'pending' }
    });

    expect(error.name).toBe('DomainInvariantError');
    expect(error.code).toBe('SESSION_NOT_ACTIVE');
    expect(error.details).toEqual({ currentStatus: 'pending' });
  });
});

describe('EntityNotFoundError', () => {
  it('should include entityType and entityId properties', () => {
    const error = new EntityNotFoundError('Session', '20260126143052');

    expect(error.name).toBe('EntityNotFoundError');
    expect(error.entityType).toBe('Session');
    expect(error.entityId).toBe('20260126143052');
    expect(error.message).toBe('Session not found: 20260126143052');
  });
});
