import { describe, it, expect } from 'vitest';
import { withTimeout, TIMEOUT } from './withTimeout.js';

describe('withTimeout', () => {
  it('resolves with the promise value when it settles in time', async () => {
    const r = await withTimeout(Promise.resolve('ok'), 50);
    expect(r).toBe('ok');
  });

  it('resolves to TIMEOUT when the promise is too slow', async () => {
    const slow = new Promise((res) => setTimeout(() => res('late'), 100));
    const r = await withTimeout(slow, 10);
    expect(r).toBe(TIMEOUT);
  });

  it('propagates rejection from the underlying promise', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });
});
