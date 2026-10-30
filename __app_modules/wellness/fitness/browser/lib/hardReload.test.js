import { describe, it, expect, vi } from 'vitest';
import hardReload from "./hardReload.js";

// Every dep records its invocation into `calls` so step ORDER is assertable.
function makeDeps() {
  const calls = [];
  const deps = {
    logger: { info: vi.fn(() => calls.push('log')) },
    flush: vi.fn(async () => { calls.push('flush-start'); await Promise.resolve(); calls.push('flush-done'); return true; }),
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
    expect(calls[0]).toBe('log');
    expect(calls[1]).toBe('flush-start');
    expect(calls.indexOf('flush-done')).toBeLessThan(calls.indexOf('reload'));
    expect(calls.filter((c) => c !== 'flush-start' && c !== 'flush-done')).toEqual([
      'log', 'cache-keys', 'cache-delete:bundle-cache', 'cache-delete:img-cache', 'fetch', 'reload'
    ]);
    expect(deps.flush).toHaveBeenCalledWith({ timeoutMs: 500 });
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

  it('flushes the log line before reloading, even when the flush is slow', async () => {
    const { calls, deps } = makeDeps();
    deps.cacheStorage = null; deps.fetchFn = null;
    let release;
    deps.flush = vi.fn(() => new Promise((resolve) => { release = () => { calls.push('flushed'); resolve(true); }; }));
    const done = hardReload('footer-longpress', deps);
    await Promise.resolve();
    expect(deps.loc.reload).not.toHaveBeenCalled();
    release();
    await done;
    expect(calls).toEqual(['log', 'flushed', 'reload']);
  });

  it('still reloads when the flush throws or rejects', async () => {
    const { deps } = makeDeps();
    deps.flush = vi.fn(() => { throw new Error('boom'); });
    await hardReload('footer-tap', deps);
    expect(deps.loc.reload).toHaveBeenCalledWith(true);
    const second = makeDeps();
    second.deps.flush = vi.fn(async () => { throw new Error('async boom'); });
    await hardReload('footer-tap', second.deps);
    expect(second.deps.loc.reload).toHaveBeenCalledWith(true);
  });
});
