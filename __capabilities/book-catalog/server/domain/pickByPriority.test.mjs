import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickByPriority } from './pickByPriority.mjs';

const C = [{ source: 'a' }, { source: 'b' }, { source: 'c' }];

/** Probes keyed by index: [delayMs, 'ok'|'fail'|'hang']. */
const probeFrom = (plan) => (candidate) => {
  const [delay, kind] = plan[C.indexOf(candidate)];
  if (kind === 'hang') return new Promise(() => {});
  return new Promise((resolve, reject) => {
    setTimeout(() => (kind === 'ok' ? resolve(`v-${candidate.source}`) : reject(new Error('miss'))), delay);
  });
};

describe('pickByPriority', () => {
  let t0;
  beforeEach(() => { vi.useFakeTimers(); t0 = Date.now(); });
  afterEach(() => { vi.useRealTimers(); });

  const run = async (plan) => {
    let done = null;
    const p = pickByPriority(C, probeFrom(plan), { now: () => Date.now() }).then((r) => { done = { r, at: Date.now() - t0 }; });
    return { p, get: () => done };
  };

  it('index 2 succeeds at 50ms, 0 and 1 fail at 100ms: index 2 at ~100ms', async () => {
    const h = await run([[100, 'fail'], [100, 'fail'], [50, 'ok']]);
    await vi.advanceTimersByTimeAsync(60);
    expect(h.get()).toBeNull();
    await vi.advanceTimersByTimeAsync(50);
    await h.p;
    expect(h.get().r).toMatchObject({ index: 2, value: 'v-c', attempts: 3 });
    expect(h.get().r.tried).toEqual(['a', 'b', 'c']);
    expect(h.get().at).toBe(100);
  });

  it('index 0 succeeds at 300ms, 2 at 50ms: index 0', async () => {
    const h = await run([[300, 'ok'], [100, 'fail'], [50, 'ok']]);
    await vi.advanceTimersByTimeAsync(400);
    await h.p;
    expect(h.get().r).toMatchObject({ index: 0, value: 'v-a' });
    expect(h.get().at).toBe(300);
  });

  it('index 0 hangs, 1 succeeds at 50ms: index 1 at 2500ms', async () => {
    const h = await run([[0, 'hang'], [50, 'ok'], [0, 'hang']]);
    await vi.advanceTimersByTimeAsync(2400);
    expect(h.get()).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    await h.p;
    expect(h.get().r).toMatchObject({ index: 1, value: 'v-b' });
    expect(h.get().at).toBe(2500);
  });

  it('all fail: null', async () => {
    const h = await run([[10, 'fail'], [20, 'fail'], [30, 'fail']]);
    await vi.advanceTimersByTimeAsync(100);
    await h.p;
    expect(h.get().r).toBeNull();
  });

  it('everything hangs: null at 6000ms', async () => {
    const h = await run([[0, 'hang'], [0, 'hang'], [0, 'hang']]);
    await vi.advanceTimersByTimeAsync(5900);
    expect(h.get()).toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    await h.p;
    expect(h.get().r).toBeNull();
    expect(h.get().at).toBe(6000);
  });

  it('empty candidate list: null', async () => {
    expect(await pickByPriority([], () => Promise.resolve(1), {})).toBeNull();
  });
});
