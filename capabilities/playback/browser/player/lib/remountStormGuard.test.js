import { describe, it, expect } from 'vitest';
import { createRemountStormGuard } from './remountStormGuard.js';

describe('createRemountStormGuard', () => {
  it('allows normal remounts', () => {
    const g = createRemountStormGuard({ maxMounts: 5, windowMs: 30000 });
    expect(g.admit('k1', 0)).toBe(true);
    expect(g.admit('k2', 1000)).toBe(true);
    expect(g.tripped()).toBe(false);
  });

  it('trips once the mount count exceeds the cap inside the window', () => {
    const g = createRemountStormGuard({ maxMounts: 3, windowMs: 10000 });
    expect(g.admit('a', 0)).toBe(true);
    expect(g.admit('b', 100)).toBe(true);
    expect(g.admit('c', 200)).toBe(true);
    expect(g.admit('d', 300)).toBe(false);
    expect(g.tripped()).toBe(true);
  });

  it('does not trip when the mounts are spread beyond the window', () => {
    const g = createRemountStormGuard({ maxMounts: 3, windowMs: 1000 });
    expect(g.admit('a', 0)).toBe(true);
    expect(g.admit('b', 2000)).toBe(true);
    expect(g.admit('c', 4000)).toBe(true);
    expect(g.admit('d', 6000)).toBe(true);
    expect(g.tripped()).toBe(false);
  });

  it('repeating the SAME key is free — only new keys count as remounts', () => {
    const g = createRemountStormGuard({ maxMounts: 2, windowMs: 10000 });
    expect(g.admit('same', 0)).toBe(true);
    expect(g.admit('same', 1)).toBe(true);
    expect(g.admit('same', 2)).toBe(true);
    expect(g.tripped()).toBe(false);
  });

  it('reset clears the trip', () => {
    const g = createRemountStormGuard({ maxMounts: 1, windowMs: 10000 });
    g.admit('a', 0);
    g.admit('b', 1);
    expect(g.tripped()).toBe(true);
    g.reset();
    expect(g.tripped()).toBe(false);
    expect(g.admit('c', 2)).toBe(true);
  });
});
