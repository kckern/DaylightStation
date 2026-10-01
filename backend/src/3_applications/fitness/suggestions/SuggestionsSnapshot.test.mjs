import { describe, it, expect, vi } from 'vitest';
import { SuggestionsSnapshot } from './SuggestionsSnapshot.mjs';

function harness({ settleMs = 1000 } = {}) {
  let clock = new Date(2026, 9, 1, 10, 0, 0);
  let build = 0;
  const service = {
    getSuggestions: vi.fn(async () => ({ suggestions: [{ build: ++build }] })),
    resolveSlots: (gridSize) => gridSize || 8,
  };
  const timers = [];
  const setTimer = (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; };
  const clearTimer = (t) => { if (t) t.cleared = true; };
  const fire = (ms) => timers.filter((t) => !t.cleared && t.ms === ms).forEach((t) => { t.cleared = true; t.fn(); });
  const snapshot = new SuggestionsSnapshot({
    service, setTimer, clearTimer, settleMs, now: () => clock,
    logger: { info() {}, warn() {}, debug() {} },
  });
  return { snapshot, service, timers, fire, setClock: (d) => { clock = d; } };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SuggestionsSnapshot', () => {
  it('builds once and serves the same grid to every request after that', async () => {
    const { snapshot, service } = harness();
    const a = await snapshot.getSuggestions({ gridSize: 8 });
    const b = await snapshot.getSuggestions({ gridSize: 8 });
    const c = await snapshot.getSuggestions({});
    expect(service.getSuggestions).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(c).toBe(a); // default slots resolve to the same grid
  });

  it('preload builds in the background, so the first visitor does not wait', async () => {
    const { snapshot, service } = harness();
    snapshot.preload({});
    await flush();
    await snapshot.getSuggestions({ gridSize: 8 });
    expect(service.getSuggestions).toHaveBeenCalledTimes(1);
  });

  it('a workout of many saves causes ONE rebuild, after the saves settle', async () => {
    const { snapshot, service, fire } = harness({ settleMs: 1000 });
    await snapshot.getSuggestions({ gridSize: 8 });
    for (let i = 0; i < 20; i++) snapshot.invalidate('session-saved');
    expect(service.getSuggestions).toHaveBeenCalledTimes(1);
    fire(1000);
    await flush();
    expect(service.getSuggestions).toHaveBeenCalledTimes(2);
    const after = await snapshot.getSuggestions({ gridSize: 8 });
    expect(after.suggestions[0].build).toBe(2);
    expect(service.getSuggestions).toHaveBeenCalledTimes(2);
  });

  it('a request for a stale grid waits for a fresh one instead of serving the old cards', async () => {
    const { snapshot, service } = harness();
    await snapshot.getSuggestions({ gridSize: 8 });
    snapshot.invalidate('session-saved');
    const fresh = await snapshot.getSuggestions({ gridSize: 8 });
    expect(fresh.suggestions[0].build).toBe(2);
    expect(service.getSuggestions).toHaveBeenCalledTimes(2);
  });

  it('a save landing mid-build leaves the grid stale for the next request', async () => {
    const { snapshot, service } = harness();
    let release;
    service.getSuggestions.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const pending = snapshot.getSuggestions({ gridSize: 8 });
    snapshot.invalidate('session-saved');
    release({ suggestions: [{ build: 'mid' }] });
    await pending;
    await snapshot.getSuggestions({ gridSize: 8 });
    expect(service.getSuggestions).toHaveBeenCalledTimes(2);
  });

  it('rebuilds when the day turns', async () => {
    const { snapshot, service, setClock } = harness();
    await snapshot.getSuggestions({ gridSize: 8 });
    setClock(new Date(2026, 9, 2, 6, 0, 0));
    const next = await snapshot.getSuggestions({ gridSize: 8 });
    expect(next.suggestions[0].build).toBe(2);
    expect(service.getSuggestions).toHaveBeenCalledTimes(2);
  });

  it('arms a rebuild just after local midnight', async () => {
    const { snapshot, timers } = harness();
    snapshot.preload({});
    const midnight = timers.find((t) => t.ms > 60_000);
    // 10:00 -> 00:01 next day
    expect(midnight.ms).toBe((14 * 60 + 1) * 60_000);
  });

  it('keeps serving the last grid when a rebuild fails', async () => {
    const { snapshot, service } = harness();
    const first = await snapshot.getSuggestions({ gridSize: 8 });
    snapshot.invalidate('session-saved');
    service.getSuggestions.mockRejectedValueOnce(new Error('plex down'));
    const during = await snapshot.getSuggestions({ gridSize: 8 });
    expect(during).toBe(first);
    const after = await snapshot.getSuggestions({ gridSize: 8 });
    expect(after.suggestions[0].build).toBe(2);
  });
});
