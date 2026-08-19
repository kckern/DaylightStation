import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Logger is mocked so the observability contract (driver / health / stalled) is
// asserted rather than assumed. `vi.hoisted` keeps the spy object alive above the
// hoisted `vi.mock` factory.
const log = vi.hoisted(() => {
  const spy = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
  };
  spy.child = vi.fn(() => spy);
  return spy;
});
vi.mock('../logging/Logger.js', () => ({ default: () => log, getLogger: () => log }));

const { createMediaClock, useMediaClock, useMediaClockState } = await import('./useMediaClock.js');

/**
 * Minimal stand-in for an HTMLMediaElement: a real EventTarget with the three
 * fields the clock reads, plus optional rVFC. `withRvfc: false` models an <audio>
 * element (and every non-Chromium engine), which is the fallback path.
 */
function makeMediaEl({ withRvfc = true, duration = 100, paused = false } = {}) {
  const el = new EventTarget();
  el.currentTime = 0;
  el.duration = duration;
  el.paused = paused;

  const realAdd = el.addEventListener.bind(el);
  const realRemove = el.removeEventListener.bind(el);
  el.listeners = new Map();
  el.addEventListener = (type, fn, opts) => {
    el.listeners.set(type, (el.listeners.get(type) || 0) + 1);
    realAdd(type, fn, opts);
  };
  el.removeEventListener = (type, fn, opts) => {
    const n = (el.listeners.get(type) || 0) - 1;
    if (n <= 0) el.listeners.delete(type); else el.listeners.set(type, n);
    realRemove(type, fn, opts);
  };
  el.listenerCount = () => [...el.listeners.values()].reduce((a, b) => a + b, 0);

  if (withRvfc) {
    el.frameCallbacks = new Map();
    let nextId = 1;
    el.requestVideoFrameCallback = (cb) => {
      const id = nextId++;
      el.frameCallbacks.set(id, cb);
      return id;
    };
    el.cancelVideoFrameCallback = (id) => { el.frameCallbacks.delete(id); };
    // Drive one "displayed frame": run every pending callback exactly once.
    el.frame = () => {
      const pending = [...el.frameCallbacks.entries()];
      el.frameCallbacks.clear();
      pending.forEach(([, cb]) => cb(0, {}));
    };
  }
  return el;
}

describe('createMediaClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(log).forEach((fn) => fn.mockClear?.());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('updates position from timeupdate events', () => {
    const el = makeMediaEl({ withRvfc: false });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();

    expect(clock.getState().position).toBe(0);

    el.currentTime = 12.5;
    el.dispatchEvent(new Event('timeupdate'));

    expect(clock.getState().position).toBeCloseTo(12.5);
    expect(clock.getState().duration).toBeCloseTo(100);
    expect(clock.getState().playing).toBe(true);
    clock.stop();
  });

  it('notifies subscribers and honours unsubscribe', () => {
    const el = makeMediaEl({ withRvfc: false });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();

    const seen = [];
    const off = clock.subscribe((s) => seen.push(s.position));
    el.currentTime = 3;
    el.dispatchEvent(new Event('timeupdate'));
    off();
    el.currentTime = 9;
    el.dispatchEvent(new Event('timeupdate'));

    expect(seen).toContain(3);
    expect(seen).not.toContain(9);
    clock.stop();
  });

  it('sets the seeking flag on seeking and clears it on seeked with the new position', () => {
    const el = makeMediaEl({ withRvfc: false });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();

    el.dispatchEvent(new Event('seeking'));
    expect(clock.getState().seeking).toBe(true);

    el.currentTime = 42;
    el.dispatchEvent(new Event('seeked'));
    expect(clock.getState().seeking).toBe(false);
    expect(clock.getState().position).toBeCloseTo(42);
    clock.stop();
  });

  it('tracks playing across pause/playing/ended', () => {
    const el = makeMediaEl({ withRvfc: false });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();

    el.paused = true;
    el.dispatchEvent(new Event('pause'));
    expect(clock.getState().playing).toBe(false);

    el.paused = false;
    el.dispatchEvent(new Event('playing'));
    expect(clock.getState().playing).toBe(true);
    clock.stop();
  });

  it('yields zeroed state and never throws when the element is null', () => {
    const clock = createMediaClock({ getMediaEl: () => null, contentId: 'piece-1' });
    expect(() => clock.start()).not.toThrow();
    expect(clock.getState()).toEqual({ position: 0, duration: 0, playing: false, seeking: false });
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(() => clock.stop()).not.toThrow();
    expect(log.debug).not.toHaveBeenCalledWith('surround.clock.driver', expect.anything());
  });

  it('zeroes state when the element goes away after having been attached', () => {
    let el = makeMediaEl({ withRvfc: false });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();

    el.currentTime = 12;
    el.dispatchEvent(new Event('timeupdate'));
    expect(clock.getState().position).toBeCloseTo(12);

    el = null; // player unmounted / transport swapped to audio-only
    vi.advanceTimersByTime(500);

    expect(clock.getState()).toEqual({ position: 0, duration: 0, playing: false, seeking: false });
    clock.stop();
  });

  it('removes every listener and cancels rVFC on stop', () => {
    const el = makeMediaEl({ withRvfc: true });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();

    expect(el.listenerCount()).toBeGreaterThan(0);
    expect(el.frameCallbacks.size).toBe(1);

    clock.stop();
    expect(el.listenerCount()).toBe(0);
    expect(el.frameCallbacks.size).toBe(0);
  });

  it('uses the rVFC driver when the element supports it', () => {
    const el = makeMediaEl({ withRvfc: true });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();

    expect(log.debug).toHaveBeenCalledWith(
      'surround.clock.driver',
      expect.objectContaining({ driver: 'rvfc', contentId: 'piece-1' }),
    );

    el.currentTime = 7;
    el.frame();
    expect(clock.getState().position).toBeCloseTo(7);
    // Loop re-arms itself for the next displayed frame.
    expect(el.frameCallbacks.size).toBe(1);
    clock.stop();
  });

  it('falls back to timeupdate when rVFC is unavailable', () => {
    const el = makeMediaEl({ withRvfc: false });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();

    expect(log.debug).toHaveBeenCalledWith(
      'surround.clock.driver',
      expect.objectContaining({ driver: 'timeupdate' }),
    );
    clock.stop();
  });

  it('re-attaches when the element identity changes and drops the old listeners', () => {
    let el = makeMediaEl({ withRvfc: false });
    const first = el;
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();
    expect(first.listenerCount()).toBeGreaterThan(0);

    const second = makeMediaEl({ withRvfc: false, duration: 200 });
    el = second;
    vi.advanceTimersByTime(500);

    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount()).toBeGreaterThan(0);

    second.currentTime = 5;
    second.dispatchEvent(new Event('timeupdate'));
    expect(clock.getState().duration).toBeCloseTo(200);
    clock.stop();
  });

  it('warns surround.clock.stalled when playing with no tick for 5s', () => {
    const el = makeMediaEl({ withRvfc: true });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();

    el.currentTime = 1;
    el.frame(); // one tick, then the rVFC loop goes dead (no further frames)
    expect(log.warn).not.toHaveBeenCalledWith('surround.clock.stalled', expect.anything());

    vi.advanceTimersByTime(6000);
    expect(log.warn).toHaveBeenCalledWith(
      'surround.clock.stalled',
      expect.objectContaining({ contentId: 'piece-1', driver: 'rvfc' }),
    );

    // Re-arms: a fresh tick clears the stall, another 5s of silence warns again.
    log.warn.mockClear();
    el.frame();
    vi.advanceTimersByTime(6000);
    expect(log.warn).toHaveBeenCalledWith('surround.clock.stalled', expect.anything());
    clock.stop();
  });

  it('does not warn stalled while paused', () => {
    const el = makeMediaEl({ withRvfc: false, paused: true });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();
    el.dispatchEvent(new Event('pause'));

    vi.advanceTimersByTime(20000);
    expect(log.warn).not.toHaveBeenCalledWith('surround.clock.stalled', expect.anything());
    clock.stop();
  });

  it('emits sampled surround.clock.health with the driver and tick rate', () => {
    const el = makeMediaEl({ withRvfc: false });
    const clock = createMediaClock({ getMediaEl: () => el, contentId: 'piece-1' });
    clock.start();

    for (let i = 0; i < 20; i += 1) {
      el.currentTime = i * 0.05;
      el.dispatchEvent(new Event('timeupdate'));
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(1000);

    expect(log.sampled).toHaveBeenCalledWith(
      'surround.clock.health',
      expect.objectContaining({
        contentId: 'piece-1',
        driver: 'timeupdate',
        ticksPerSec: expect.any(Number),
        sampledHz: expect.any(Number),
      }),
      expect.objectContaining({ maxPerMinute: 1 }),
    );
    clock.stop();
  });
});

describe('useMediaClock / useMediaClockState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(log).forEach((fn) => fn.mockClear?.());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('exposes a stable { subscribe, getState } handle', () => {
    const el = makeMediaEl({ withRvfc: false });
    const { result, rerender } = renderHook(() => useMediaClock({ getMediaEl: () => el, contentId: 'p' }));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(typeof first.subscribe).toBe('function');
    expect(typeof first.getState).toBe('function');
  });

  it('removes listeners when the hook unmounts', () => {
    const el = makeMediaEl({ withRvfc: true });
    const { unmount } = renderHook(() => useMediaClock({ getMediaEl: () => el, contentId: 'p' }));
    expect(el.listenerCount()).toBeGreaterThan(0);
    unmount();
    expect(el.listenerCount()).toBe(0);
    expect(el.frameCallbacks.size).toBe(0);
  });

  it('yields zeroed state for a null element without throwing', () => {
    const { result } = renderHook(() => useMediaClockState({ getMediaEl: () => null }));
    expect(result.current).toEqual({ position: 0, duration: 0, playing: false, seeking: false });
  });

  it('throttles React updates to the configured hz instead of the raw tick rate', () => {
    const el = makeMediaEl({ withRvfc: true });
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useMediaClockState({ getMediaEl: () => el, contentId: 'p', hz: 10 });
    });
    const baseline = renders;

    // 40 frames over 1000ms ≈ 40Hz, the real rVFC rate on this hardware. Each
    // frame gets its OWN act() so React flushes between them — batching a whole
    // burst inside one act() would collapse 40 unthrottled commits into a single
    // render and make this assertion vacuous.
    for (let i = 0; i < 40; i += 1) {
      act(() => {
        el.currentTime = (i + 1) * 0.025;
        el.frame();
        vi.advanceTimersByTime(25);
      });
    }
    const throttled = renders - baseline;

    expect(throttled).toBeGreaterThan(0);
    // At 10Hz over ~1s the ceiling is ~11 commits; 40 would mean no throttle at all.
    expect(throttled).toBeLessThanOrEqual(13);
    expect(throttled).toBeLessThan(20);

    // Trailing edge: the final tick must still land, so the cursor never freezes
    // one throttle-window short of the truth.
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.position).toBeCloseTo(1.0, 5);
  });

  it('commits seeking transitions immediately rather than waiting for the throttle', () => {
    const el = makeMediaEl({ withRvfc: false });
    const { result } = renderHook(() => useMediaClockState({ getMediaEl: () => el, contentId: 'p', hz: 10 }));

    act(() => { el.dispatchEvent(new Event('seeking')); });
    expect(result.current.seeking).toBe(true);

    act(() => { el.currentTime = 55; el.dispatchEvent(new Event('seeked')); });
    expect(result.current.seeking).toBe(false);
    expect(result.current.position).toBeCloseTo(55);
  });
});
