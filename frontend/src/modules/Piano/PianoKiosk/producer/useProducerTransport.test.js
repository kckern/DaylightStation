/**
 * useProducerTransport — the multi-channel, bar-aligned transport (Task 4.2).
 *
 * Timing is driven by a manual rAF queue + a mocked performance.now(), so
 * every test advances the wall clock deterministically frame by frame. The
 * shared schedulers (loopScheduler / arrangementScheduler / percussion) are
 * REAL — only the router is mocked; these are integration tests of the
 * transport against the actual event builders.
 *
 * Fixed grid used throughout: bpm 120, 4/4 → barMs 2000, beatMs 500;
 * ppq 480 → quarter note = 500ms, one bar = 1920 ticks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProducerTransport } from './useProducerTransport.js';

// ── manual clock + rAF queue ─────────────────────────────────────────────────

let now = 0;
let rafCbs = new Map();
let nextRafId = 1;

beforeEach(() => {
  now = 0;
  rafCbs = new Map();
  nextRafId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    const id = nextRafId;
    nextRafId += 1;
    rafCbs.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id) => {
    rafCbs.delete(id);
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Advance the wall clock to t and run the currently queued rAF callbacks
 * (one tick generation — the tick re-queues itself for the next frame). */
function frameAt(t) {
  now = t;
  const cbs = [...rafCbs.values()];
  rafCbs.clear();
  cbs.forEach((cb) => cb(t));
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const makeRouter = () => ({ noteOn: vi.fn(), noteOff: vi.fn(), panic: vi.fn() });

/** One-note loop layer (loopScheduler shape). */
const layer = (midi, { ticks = 0, dur = 480, channel = 0, barSpan = 1 } = {}) => ({
  notes: [{ ticks, durationTicks: dur, midi }],
  ppq: 480,
  channel,
  barSpan,
});

const BASE = { bpm: 120, timeSig: [4, 4] };

function mount(props) {
  return renderHook((p) => useProducerTransport(p), { initialProps: props });
}

const play = (result) => act(() => result.current.play());

/** All noteOn calls on a given channel. */
const onCalls = (router, channel) => router.noteOn.mock.calls.filter((c) => c[0] === channel);

// ── stack mode ───────────────────────────────────────────────────────────────

describe('stack mode', () => {
  it('dispatches events through the router WITH their channel', () => {
    const router = makeRouter();
    const { result } = mount({
      router, ...BASE, layers: [layer(60, { channel: 0 }), layer(64, { channel: 2 })],
    });
    play(result);
    expect(result.current.isPlaying).toBe(true);

    frameAt(10);
    expect(router.noteOn).toHaveBeenCalledWith(0, 60, 90);
    expect(router.noteOn).toHaveBeenCalledWith(2, 64, 90);
    expect(router.noteOff).not.toHaveBeenCalled();

    frameAt(600); // note_offs at 500ms
    expect(router.noteOff).toHaveBeenCalledWith(0, 60);
    expect(router.noteOff).toHaveBeenCalledWith(2, 64);
  });

  it('loops: the cycle wraps and re-fires from the top, phase-exact', () => {
    const router = makeRouter();
    const { result } = mount({ router, ...BASE, layers: [layer(60)] });
    play(result);

    frameAt(10);
    frameAt(600);
    expect(onCalls(router, 0)).toHaveLength(1);

    frameAt(2100); // wrap at 2000 (1-bar cycle) + catch-up fire in the same tick
    expect(onCalls(router, 0)).toHaveLength(2);
    expect(result.current.positionRef.current.bar).toBe(1);
  });

  it('updates positionRef (normalized/bar/beat/blockIndex) without React state', () => {
    const router = makeRouter();
    const { result } = mount({ router, ...BASE, layers: [layer(60, { barSpan: 2 })] });
    play(result);

    frameAt(2600); // bar 1, beat 1 (2600 = bar 2000 + 600)
    const p = result.current.positionRef.current;
    expect(p.bar).toBe(1);
    expect(p.beat).toBe(1);
    expect(p.normalized).toBeCloseTo(2600 / 4000, 5);
    expect(p.blockIndex).toBe(-1);
  });
});

// ── bar-aligned mutation (THE headline feature) ─────────────────────────────

describe('bar-aligned swap', () => {
  // Old: n60 held for 2 bars (off@4000) + n62 at bar 2 (on@2000).
  const oldLayers = [{
    notes: [
      { ticks: 0, durationTicks: 3840, midi: 60 },
      { ticks: 1920, durationTicks: 480, midi: 62 },
    ],
    ppq: 480,
    channel: 0,
    barSpan: 2,
  }];
  // New: n64 at bar 1 (t=0), n65 at bar 2 (t=2000).
  const newLayers = [{
    notes: [
      { ticks: 0, durationTicks: 480, midi: 64 },
      { ticks: 1920, durationTicks: 480, midi: 65 },
    ],
    ppq: 480,
    channel: 0,
    barSpan: 2,
  }];

  it('keeps the OLD cycle until the bar boundary, then enters the NEW cycle phase-matched (no restart), releasing held notes at the seam', () => {
    const router = makeRouter();
    const { result, rerender } = mount({ router, ...BASE, layers: oldLayers });
    play(result);

    frameAt(100);
    expect(router.noteOn).toHaveBeenCalledWith(0, 60, 90);

    now = 300; // mutate mid-bar 0 — swap must wait for the bar 1 boundary (t=2000)
    rerender({ router, ...BASE, layers: newLayers });

    frameAt(1900); // still inside bar 0: nothing new fired, held note NOT cut
    expect(router.noteOff).not.toHaveBeenCalled();
    expect(onCalls(router, 0)).toHaveLength(1);

    frameAt(2050); // past the boundary: swap applied
    // seam: the held old-cycle note is released via the tracked active set
    expect(router.noteOff).toHaveBeenCalledWith(0, 60);
    // new cycle enters at ITS bar 1 (elapsed bars % its length) — n65 fires...
    expect(router.noteOn).toHaveBeenCalledWith(0, 65, 90);
    // ...NOT its bar-0 note (no restart-from-zero)...
    expect(router.noteOn.mock.calls.some((c) => c[1] === 64)).toBe(false);
    // ...and the old cycle's bar-2 note never sounds.
    expect(router.noteOn.mock.calls.some((c) => c[1] === 62)).toBe(false);

    frameAt(4100); // new cycle wraps — its bar 0 finally plays
    expect(router.noteOn).toHaveBeenCalledWith(0, 64, 90);
    expect(router.noteOn.mock.calls.filter((c) => c[1] === 64)).toHaveLength(1);
  });

  it('with the metronome on, the landing bar still gets its beat-1 accent at the seam', () => {
    const router = makeRouter();
    const { rerender, result } = mount({ router, ...BASE, layers: oldLayers, metronome: true });
    play(result);
    frameAt(100); // bar 0 accent
    expect(router.noteOn.mock.calls.filter((c) => c[0] === 9 && c[2] === 110)).toHaveLength(1);

    now = 300;
    rerender({ router, ...BASE, layers: newLayers, metronome: true });

    frameAt(2050); // swap seam at bar 1 — accent must not be swallowed
    expect(router.noteOn.mock.calls.filter((c) => c[0] === 9 && c[2] === 110)).toHaveLength(2);
  });

  it('change while playing → stop BEFORE the boundary → play: the NEW content sounds (no stale-cycle resurrection)', () => {
    const router = makeRouter();
    const { result, rerender } = mount({ router, ...BASE, layers: oldLayers });
    play(result);
    frameAt(100);

    now = 300;
    rerender({ router, ...BASE, layers: newLayers }); // queues a swap for t=2000...
    act(() => result.current.stop()); // ...which is discarded here

    now = 500;
    play(result);
    frameAt(510);
    expect(router.noteOn).toHaveBeenCalledWith(0, 64, 90); // new cycle, from ITS bar 0
    expect(router.noteOn.mock.calls.filter((c) => c[1] === 60)).toHaveLength(1); // only the pre-stop old note
  });

  it('a change while idle installs immediately (no pending swap machinery)', () => {
    const router = makeRouter();
    const { result, rerender } = mount({ router, ...BASE, layers: oldLayers });
    rerender({ router, ...BASE, layers: [layer(72)] });
    play(result);
    frameAt(10);
    expect(router.noteOn).toHaveBeenCalledWith(0, 72, 90);
    expect(router.noteOn.mock.calls.some((c) => c[1] === 60)).toBe(false);
  });
});

// ── stop / unmount contracts ─────────────────────────────────────────────────

describe('stop & unmount', () => {
  it('stop() calls router.panic() — the review-carried BLE contract', () => {
    const router = makeRouter();
    const { result } = mount({ router, ...BASE, layers: [layer(60)] });
    play(result);
    frameAt(100);
    act(() => result.current.stop());
    expect(router.panic).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);
    // clock stopped: no further dispatch
    const calls = router.noteOn.mock.calls.length;
    frameAt(3000);
    expect(router.noteOn.mock.calls.length).toBe(calls);
  });

  it('unmount while playing stops the clock and panics', () => {
    const router = makeRouter();
    const { result, unmount } = mount({ router, ...BASE, layers: [layer(60)] });
    play(result);
    frameAt(100);
    unmount();
    expect(router.panic).toHaveBeenCalled();
    const calls = router.noteOn.mock.calls.length;
    frameAt(3000);
    expect(router.noteOn.mock.calls.length).toBe(calls);
  });
});

// ── count-in ─────────────────────────────────────────────────────────────────

describe('count-in', () => {
  it('fires ONLY metronome for N bars (onBar -N..-1), then content at bar 0', () => {
    const router = makeRouter();
    const onBar = vi.fn();
    const { result } = mount({
      router, ...BASE, layers: [layer(60)], countInBars: 2, onBar,
    });
    play(result); // content starts at t=4000

    frameAt(10);
    expect(onBar).toHaveBeenLastCalledWith(-2);
    expect(router.noteOn).toHaveBeenCalledWith(9, 42, 110); // accent click, ch 9
    expect(onCalls(router, 0)).toHaveLength(0); // NO content during count-in

    frameAt(2010);
    expect(onBar).toHaveBeenLastCalledWith(-1);
    expect(onCalls(router, 0)).toHaveLength(0);

    frameAt(4010);
    expect(onBar).toHaveBeenLastCalledWith(0);
    expect(router.noteOn).toHaveBeenCalledWith(0, 60, 90); // content begins at bar 0
    expect(onBar.mock.calls.map((c) => c[0])).toEqual([-2, -1, 0]);
  });
});

// ── metronome overlay ────────────────────────────────────────────────────────

describe('metronome overlay', () => {
  it('merges channel-9 click events into the fired stream alongside content', () => {
    const router = makeRouter();
    const { result } = mount({ router, ...BASE, layers: [layer(60)], metronome: true });
    play(result);

    frameAt(10); // beat 1: accent click AND content note in the same stream
    expect(router.noteOn).toHaveBeenCalledWith(9, 42, 110);
    expect(router.noteOn).toHaveBeenCalledWith(0, 60, 90);

    frameAt(510); // beat 2: unaccented tick
    expect(router.noteOn).toHaveBeenCalledWith(9, 42, 70);
  });
});

// ── arrangement mode ─────────────────────────────────────────────────────────

const secA = {
  id: 'a',
  lengthBars: 1,
  stack: [{ notes: [{ ticks: 0, durationTicks: 1920, midi: 60 }], ppq: 480, channel: 0 }],
};
const secB = {
  id: 'b',
  lengthBars: 1,
  stack: [{ notes: [{ ticks: 0, durationTicks: 1920, midi: 72 }], ppq: 480, channel: 1 }],
};
const secZero = { id: 'z', lengthBars: 0, stack: [secA.stack[0]] }; // degenerate → lengthMs 0 block

describe('arrangement mode', () => {
  it('walks blocks with block-local offsets, fires onBlock at boundaries, skips zero-length blocks without spinning, and loops', () => {
    const router = makeRouter();
    const onBlock = vi.fn();
    const { result } = mount({
      router,
      ...BASE,
      layers: [],
      arrangement: {
        sections: [secA, secZero, secB],
        arrangement: [{ sectionId: 'a' }, { sectionId: 'z' }, { sectionId: 'b' }],
      },
      onBlock,
    });
    // blocks: a[0,2000) · z[2000, len 0] · b[2000,4000); total 4000
    expect(result.current.lengthMs).toBe(4000);
    play(result);

    frameAt(100);
    expect(onBlock).toHaveBeenCalledTimes(1);
    expect(onBlock).toHaveBeenLastCalledWith(0, expect.objectContaining({ sectionId: 'a' }));
    expect(router.noteOn).toHaveBeenCalledWith(0, 60, 90);
    expect(onCalls(router, 1)).toHaveLength(0); // b's note NOT early — offsets are block-local

    frameAt(2100); // boundary: a finishes, z (lengthMs 0) is stepped past, b starts
    expect(onBlock.mock.calls.map((c) => c[0])).toEqual([0, 1, 2]);
    expect(router.noteOff).toHaveBeenCalledWith(0, 60);
    expect(router.noteOn).toHaveBeenCalledWith(1, 72, 90);
    expect(result.current.positionRef.current.blockIndex).toBe(2);

    frameAt(4100); // arrangement loops back to block 0
    expect(onBlock.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 0]);
    expect(onCalls(router, 0)).toHaveLength(2);
  });

  it('queueJump (repeat mode) lands at the current block END: seam released, target block events after', () => {
    const router = makeRouter();
    const onBlock = vi.fn();
    const { result } = mount({
      router,
      ...BASE,
      layers: [],
      arrangement: {
        sections: [secA, secB],
        arrangement: [{ sectionId: 'a', repeats: 2 }, { sectionId: 'b' }],
      },
      onBlock,
    });
    // blocks: a0[0,2000) · a1[2000,4000) · b[4000,6000)
    play(result);
    frameAt(100);
    expect(router.noteOn).toHaveBeenCalledWith(0, 60, 90);

    now = 500;
    act(() => result.current.queueJump(2, 'repeat'));
    expect(result.current.pendingJumpRef.current).toMatchObject({ targetIdx: 2, atMs: 2000 });

    frameAt(1900); // still in a0 — nothing jumped yet
    expect(onCalls(router, 1)).toHaveLength(0);

    frameAt(2050); // block end reached: jump lands
    expect(router.noteOff).toHaveBeenCalledWith(0, 60); // seam release via active set
    expect(router.noteOn).toHaveBeenCalledWith(1, 72, 90); // target block (b) sounding
    expect(onCalls(router, 0)).toHaveLength(1); // a1 (the skipped repeat) never played
    expect(onBlock).toHaveBeenLastCalledWith(2, expect.objectContaining({ sectionId: 'b' }));
    expect(result.current.pendingJumpRef.current).toBeNull();
  });

  it('barMs guard: garbage bpm never leaks NaN into nextJumpPoint — queueJump still resolves finitely', () => {
    const router = makeRouter();
    const { result } = mount({
      router,
      bpm: NaN, // sanitized centrally to 120 → barMs 2000
      timeSig: [4, 4],
      layers: [],
      arrangement: {
        sections: [secA, secB],
        arrangement: [{ sectionId: 'a' }, { sectionId: 'b' }],
      },
    });
    expect(Number.isFinite(result.current.lengthMs)).toBe(true);
    play(result);
    frameAt(600);
    act(() => result.current.queueJump(1, 'bar'));
    const pending = result.current.pendingJumpRef.current;
    expect(pending).not.toBeNull();
    expect(Number.isFinite(pending.atMs)).toBe(true);
    expect(pending.atMs).toBe(2000); // next bar == block end, clean number
  });

  it('queueJump is a no-op outside arrangement playback', () => {
    const router = makeRouter();
    const { result } = mount({ router, ...BASE, layers: [layer(60)] });
    play(result);
    frameAt(100);
    act(() => result.current.queueJump(1, 'repeat'));
    expect(result.current.pendingJumpRef.current).toBeNull();
  });
});
