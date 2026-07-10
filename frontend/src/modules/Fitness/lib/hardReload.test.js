import { describe, it, expect, vi } from 'vitest';
import hardReload from './hardReload.js';

// Every dep records its invocation into `calls` so step ORDER is assertable.
function makeDeps() {
  const calls = [];
  const deps = {
    logger: { info: vi.fn(() => calls.push('log')) },
    cacheStorage: {
      keys: vi.fn(async () => { calls.push('cache-keys'); return ['bundle-cache', 'img-cache']; }),
      delete: vi.fn(async (key) => { calls.push(`cache-delete:${key}`); return true; })
    },
    fetchFn: vi.fn(async () => { calls.push('fetch'); return { ok: true }; }),
    loc: { pathname: '/fitness', reload: vi.fn(() => calls.push('reload')) }
  };
  return { calls, deps };
}

describe('hardReload', () => {
  it('runs log → clear caches → revalidate fetch → forced reload, in order', async () => {
    const { calls, deps } = makeDeps();
    await hardReload('settings-menu', deps);
    expect(calls).toEqual([
      'log', 'cache-keys', 'cache-delete:bundle-cache', 'cache-delete:img-cache', 'fetch', 'reload'
    ]);
    expect(deps.logger.info).toHaveBeenCalledWith('fitness-hard-reload', { source: 'settings-menu' });
    expect(deps.fetchFn).toHaveBeenCalledWith('/fitness', { cache: 'reload' });
    // Firefox honors the non-standard forceGet flag; other browsers ignore it.
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
  });

  it('still reloads when the Cache API throws', async () => {
    const { deps } = makeDeps();
    deps.cacheStorage.keys = vi.fn(async () => { throw new Error('cache broken'); });
    await hardReload('footer-tap', deps);
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
  });

  it('still reloads when the revalidation fetch rejects', async () => {
    const { deps } = makeDeps();
    deps.fetchFn = vi.fn(async () => { throw new Error('offline'); });
    await hardReload('footer-longpress', deps);
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
  });

  it('still reloads when no Cache API exists (cacheStorage null)', async () => {
    const { deps } = makeDeps();
    deps.cacheStorage = null;
    await hardReload('footer-tap', deps);
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
  });

  it('still reloads when the logger throws', async () => {
    const { deps } = makeDeps();
    deps.logger = { info: vi.fn(() => { throw new Error('log sink gone'); }) };
    await hardReload('settings-menu', deps);
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
  });
});
