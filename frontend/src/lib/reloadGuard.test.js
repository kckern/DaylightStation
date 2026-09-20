import { describe, it, expect, vi, beforeEach } from 'vitest';
import { canReload, trackReload, getReloadCount, guardedReload, clearReloadGuard, MAX_RELOADS } from './reloadGuard.js';

vi.mock('./logging/Logger.js', () => ({
  default: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

// The custom happy-dom test env doesn't expose sessionStorage; provide an
// in-memory stand-in so the guard's persistence logic is actually exercised.
function installTestEnv() {
  const store = new Map();
  Object.defineProperty(window, 'sessionStorage', {
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    },
    writable: true,
    configurable: true,
  });
  const reload = vi.fn();
  window.location.reload = reload;
  return reload;
}

describe('reloadGuard', () => {
  beforeEach(() => {
    installTestEnv();
    clearReloadGuard();
  });

  it('allows reloads up to MAX_RELOADS within the window', () => {
    for (let i = 0; i < MAX_RELOADS; i++) {
      expect(canReload()).toBe(true);
      trackReload();
    }
    expect(getReloadCount()).toBe(MAX_RELOADS);
  });

  it('blocks once the limit is exceeded', () => {
    for (let i = 0; i < MAX_RELOADS; i++) trackReload();
    expect(canReload()).toBe(false);
  });

  // This is the exact bug that made the guard dead code: a module-level array
  // is wiped by the very reload it exists to count, so a fresh module
  // instance (standing in for "the page just reloaded") must still see the
  // history that was recorded before it.
  it('survives a reload — history persists across a fresh module instance', async () => {
    trackReload();
    trackReload();
    vi.resetModules();
    const fresh = await import('./reloadGuard.js');
    expect(fresh.getReloadCount()).toBe(2);
  });

  it('guardedReload navigates when under the limit and logs the reason', () => {
    const reload = installTestEnv();
    const fallback = vi.fn();
    guardedReload({ reason: 'test-reason', fallbackAction: fallback });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(getReloadCount()).toBe(1);
  });

  it('guardedReload blocks and calls fallbackAction instead of looping once exhausted', () => {
    const reload = installTestEnv();
    for (let i = 0; i < MAX_RELOADS; i++) trackReload();
    const fallback = vi.fn();
    guardedReload({ reason: 'test-reason', fallbackAction: fallback });
    expect(reload).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('guardedReload with no fallbackAction just stops reloading (no-op) when blocked', () => {
    const reload = installTestEnv();
    for (let i = 0; i < MAX_RELOADS; i++) trackReload();
    expect(() => guardedReload({ reason: 'test-reason' })).not.toThrow();
    expect(reload).not.toHaveBeenCalled();
  });

  it('a stale entry outside the window does not count against the limit', () => {
    const store = new Map();
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      },
      writable: true,
      configurable: true,
    });
    store.set('daylight.reloadGuard.history', JSON.stringify([Date.now() - 60000]));
    expect(getReloadCount()).toBe(0);
    expect(canReload()).toBe(true);
  });
});
