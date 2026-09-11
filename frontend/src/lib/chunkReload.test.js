import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isChunkLoadError,
  recoverFromChunkError,
  importWithReload,
  clearChunkReloadGuard,
  RELOAD_GUARD_TTL_MS,
} from './chunkReload.js';

// Silence the logger (it tries to reach a websocket otherwise)
vi.mock('./logging/singleton.js', () => ({
  getChildLogger: () => ({ warn() {}, error() {}, info() {}, debug() {} }),
}));

// The custom happy-dom test env doesn't expose sessionStorage; provide an
// in-memory stand-in and a reload stub so the guard logic is exercised.
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

describe('isChunkLoadError', () => {
  it('matches Chrome/Edge dynamic import failure', () => {
    expect(
      isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/assets/Foo-abc.js')),
    ).toBe(true);
  });

  it('matches Firefox phrasing', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
  });

  it('matches Safari phrasing', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('matches legacy webpack ChunkLoadError', () => {
    expect(isChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true);
  });

  it('reads .reason (unhandledrejection event)', () => {
    expect(isChunkLoadError({ reason: { message: 'Failed to fetch dynamically imported module' } })).toBe(true);
  });

  it('reads .payload (vite:preloadError event)', () => {
    expect(isChunkLoadError({ payload: { message: 'Failed to fetch dynamically imported module' } })).toBe(true);
  });

  it('accepts a bare string', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('recoverFromChunkError', () => {
  let reload;
  beforeEach(() => {
    reload = installTestEnv();
    clearChunkReloadGuard();
  });

  it('reloads once on a chunk error', () => {
    const triggered = recoverFromChunkError(new Error('Failed to fetch dynamically imported module'));
    expect(triggered).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload twice in the same session (no loop)', () => {
    recoverFromChunkError(new Error('Failed to fetch dynamically imported module'));
    const second = recoverFromChunkError(new Error('Failed to fetch dynamically imported module'));
    expect(second).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload for non-chunk errors', () => {
    const triggered = recoverFromChunkError(new Error('some other failure'));
    expect(triggered).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('clearing the guard re-arms recovery (future deploy)', () => {
    recoverFromChunkError(new Error('Failed to fetch dynamically imported module'));
    clearChunkReloadGuard();
    const again = recoverFromChunkError(new Error('Failed to fetch dynamically imported module'));
    expect(again).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('importWithReload', () => {
  let reload;
  beforeEach(() => {
    reload = installTestEnv();
    clearChunkReloadGuard();
  });

  it('returns the module on success and clears the guard', async () => {
    const mod = { default: 'ok' };
    const result = await importWithReload(() => Promise.resolve(mod));
    expect(result).toBe(mod);
  });

  it('hangs pending (never resolves/rejects) while it reloads on a stale chunk', async () => {
    const p = importWithReload(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module')),
    );
    const settled = await Promise.race([
      p.then(() => 'resolved', () => 'rejected'),
      new Promise((r) => setTimeout(() => r('pending'), 30)),
    ]);
    expect(settled).toBe('pending');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('rethrows a non-chunk error', async () => {
    await expect(
      importWithReload(() => Promise.reject(new Error('real bug'))),
    ).rejects.toThrow('real bug');
    expect(reload).not.toHaveBeenCalled();
  });
});

/**
 * THE KIOSK REGRESSION.
 *
 * The guard used to be a one-shot for the life of the tab: set on the first
 * recovery, cleared only by a later dynamic import SUCCEEDING. A piano tablet
 * whose tab never closes and which rarely lazy-loads anything therefore stayed
 * latched shut permanently, and every deploy afterwards left a dead chunk with
 * no recovery. On 2026-09-11 that shipped `chunk-reload.exhausted` for
 * connect-four and checkers at 16:50 and then for chess at 20:52, where a child
 * who had just passed his practice gate three times running was told the game
 * he had earned was broken.
 *
 * What the guard is actually for is "we reloaded and it STILL fails" — which
 * resolves within seconds. So it expires, and these are the two halves of that.
 */
describe('reload guard expiry (a cooldown, not a one-shot)', () => {
  let reload;
  beforeEach(() => {
    reload = installTestEnv();
    clearChunkReloadGuard();
    vi.useRealTimers();
  });

  const stale = () => new Error('Failed to fetch dynamically imported module: /assets/PianoChessGame-B0J4XdeD.js');

  it('a failure LONG after the last reload is a new deploy, and recovers', () => {
    vi.useFakeTimers();
    try {
      expect(recoverFromChunkError(stale())).toBe(true);
      expect(reload).toHaveBeenCalledTimes(1);

      // Hours later — a new build rotates the hashes again.
      vi.advanceTimersByTime(4 * 60 * 60 * 1000);

      expect(recoverFromChunkError(stale())).toBe(true);
      expect(reload).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failure moments after a reload is a REAL fault, and does not loop', () => {
    vi.useFakeTimers();
    try {
      expect(recoverFromChunkError(stale())).toBe(true);
      vi.advanceTimersByTime(RELOAD_GUARD_TTL_MS - 1000);
      expect(recoverFromChunkError(stale())).toBe(false);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stamp from the future (clock stepped back) expires rather than latching', () => {
    window.sessionStorage.setItem('daylight.chunkReload.attempted', String(Date.now() + 60 * 60 * 1000));
    expect(recoverFromChunkError(stale())).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('an unparseable stamp fails toward recovery, not toward a dead kiosk', () => {
    window.sessionStorage.setItem('daylight.chunkReload.attempted', 'true');
    expect(recoverFromChunkError(stale())).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
