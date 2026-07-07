import { describe, it, expect } from 'vitest';
import { ConfigurationError, SchedulerError, EventBusError, FileIOError } from '#system/utils/errors/index.mjs';

describe('system error classes', () => {
  it('ConfigurationError carries code/key/value', () => {
    const e = new ConfigurationError('API key required', { code: 'MISSING_SECRET', key: 'OPENAI_API_KEY' });
    expect(e.name).toBe('ConfigurationError');
    expect(e.code).toBe('MISSING_SECRET');
    expect(e.key).toBe('OPENAI_API_KEY');
    expect(e).toBeInstanceOf(Error);
  });
  it.each([[SchedulerError], [EventBusError], [FileIOError]])('%p carries code and details', (Cls) => {
    const e = new Cls('boom', { code: 'X', details: { a: 1 } });
    expect(e.code).toBe('X');
    expect(e.details).toEqual({ a: 1 });
  });
});
