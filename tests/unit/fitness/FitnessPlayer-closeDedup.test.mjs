import { describe, it, expect } from '@jest/globals';

const { makeCloseGuard } = await import('#frontend/modules/Fitness/player/closeGuard.js');

describe('makeCloseGuard', () => {
  it('returns true on first acquire, false on subsequent', () => {
    const g = makeCloseGuard();
    expect(g.acquire()).toBe(true);
    expect(g.acquire()).toBe(false);
    expect(g.acquire()).toBe(false);
  });

  it('can be reset for a new close cycle', () => {
    const g = makeCloseGuard();
    expect(g.acquire()).toBe(true);
    g.reset();
    expect(g.acquire()).toBe(true);
  });

  it('preserves the sessionId of the acquiring caller', () => {
    const g = makeCloseGuard();
    expect(g.acquire('fs_1')).toBe(true);
    expect(g.heldFor()).toBe('fs_1');
  });
});
