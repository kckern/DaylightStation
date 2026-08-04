// useKeyShift.test.jsx — Web Audio key-shift chain lifecycle (Signalsmith Stretch).
//
// The hook owns the one delicate Web Audio invariant: createMediaElementSource
// is ONE-SHOT per element (a second call throws, and once called the element's
// audio flows only through the graph). These tests pin the lifecycle around
// that: lazy build, per-element source caching, zero-latency dry bypass at the
// natural key, rebuild on element swap, and safe teardown that reroutes a
// still-alive element straight to the speakers. The stretch engine loader and
// AudioContext are mocked — jsdom has no Web Audio — so assertions target the
// graph calls, not audible output.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import useKeyShift, { STRETCH_INIT_TIMEOUT_MS } from './useKeyShift.js';

const h = vi.hoisted(() => {
  const state = { stretches: [], ctxs: [] };
  const makeStretch = () => {
    const s = {
      schedule: vi.fn(),
      connect: vi.fn((n) => n),
      disconnect: vi.fn(),
      stop: vi.fn(),
    };
    state.stretches.push(s);
    return s;
  };
  class FakeGain {
    constructor() { this.gain = { value: 1 }; }

    connect(n) { this.connected = n; return n; }

    disconnect() { this.connected = null; }
  }
  class FakeAudioContext {
    constructor() {
      this.destination = { isDestination: true };
      this.createMediaElementSource = vi.fn((el) => ({
        el,
        connect: vi.fn((n) => n),
        disconnect: vi.fn(),
      }));
      this.resume = vi.fn(() => Promise.resolve());
      state.ctxs.push(this);
    }

    createGain() { return new FakeGain(); }
  }
  return { state, makeStretch, FakeAudioContext, factory: vi.fn(async () => makeStretch()) };
});

// The hook loads the engine through loadStretchEngine.js (which serves the
// pristine npm file as a ?url asset — the bundler corrupts the package's
// self-stringifying worklet). Mock the loader, not the package.
vi.mock('./loadStretchEngine.js', () => ({ default: vi.fn(async () => h.factory) }));

const video = () => document.createElement('video');
const settle = () => new Promise((r) => setTimeout(r, 25));
const lastCtx = () => h.state.ctxs[h.state.ctxs.length - 1];
const lastSchedule = (s) => s.schedule.mock.calls.at(-1)[0];
// The hook shares one AudioContext across its whole module lifetime, so call
// counts accumulate across tests — the invariant is per-ELEMENT dedupe.
const sourceCallsFor = (el) => h.state.ctxs
  .flatMap((c) => c.createMediaElementSource.mock.calls)
  .filter((args) => args[0] === el).length;

beforeEach(() => {
  h.state.stretches.length = 0;
  h.factory.mockClear();
  vi.stubGlobal('AudioContext', h.FakeAudioContext);
});

describe('useKeyShift', () => {
  it('does not touch the audio graph while the key is natural', async () => {
    const el = video();
    renderHook(() => useKeyShift(el, 0));
    await settle();
    expect(h.factory).not.toHaveBeenCalled();
    expect(h.state.stretches.length).toBe(0);
  });

  it('builds source → stretch → destination on the first shift and schedules the semitones', async () => {
    const el = video();
    const { rerender } = renderHook(({ s }) => useKeyShift(el, s), { initialProps: { s: 0 } });
    rerender({ s: 2 });
    await waitFor(() => expect(h.state.stretches.length).toBe(1));
    expect(lastCtx().createMediaElementSource).toHaveBeenCalledWith(el);
    const stretch = h.state.stretches[0];
    await waitFor(() => expect(stretch.schedule).toHaveBeenCalled());
    expect(lastSchedule(stretch)).toMatchObject({ active: true, semitones: 2 });
  });

  it('returning to natural deactivates the stretch (dry path) without rebuilding', async () => {
    const el = video();
    const { rerender } = renderHook(({ s }) => useKeyShift(el, s), { initialProps: { s: 1 } });
    await waitFor(() => expect(h.state.stretches.length).toBe(1));
    rerender({ s: 0 });
    const stretch = h.state.stretches[0];
    await waitFor(() => expect(lastSchedule(stretch)).toMatchObject({ active: false }));
    expect(h.state.stretches.length).toBe(1);
    expect(sourceCallsFor(el)).toBe(1);
  });

  it('never creates a second source for the same element', async () => {
    const el = video();
    const { rerender } = renderHook(({ s }) => useKeyShift(el, s), { initialProps: { s: 1 } });
    await waitFor(() => expect(h.state.stretches.length).toBe(1));
    rerender({ s: 2 });
    rerender({ s: 3 });
    const stretch = h.state.stretches[0];
    await waitFor(() => expect(lastSchedule(stretch)).toMatchObject({ semitones: 3 }));
    expect(sourceCallsFor(el)).toBe(1);
  });

  it('waits for a media element, then applies the pending shift', async () => {
    const { rerender } = renderHook(({ el }) => useKeyShift(el, 3), { initialProps: { el: null } });
    await settle();
    expect(h.state.stretches.length).toBe(0);
    const el = video();
    rerender({ el });
    await waitFor(() => expect(h.state.stretches.length).toBe(1));
    await waitFor(() => expect(lastSchedule(h.state.stretches[0])).toMatchObject({ semitones: 3 }));
  });

  it('rebuilds on media element swap, stopping the old stretch', async () => {
    const elA = video();
    const elB = video();
    const { rerender } = renderHook(({ el }) => useKeyShift(el, 2), { initialProps: { el: elA } });
    await waitFor(() => expect(h.state.stretches.length).toBe(1));
    rerender({ el: elB });
    await waitFor(() => expect(h.state.stretches.length).toBe(2));
    expect(h.state.stretches[0].stop).toHaveBeenCalled();
    expect(lastCtx().createMediaElementSource).toHaveBeenCalledWith(elB);
    await waitFor(() => expect(lastSchedule(h.state.stretches[1])).toMatchObject({ semitones: 2 }));
  });

  it('a cancelled build superseded by a newer one must not wire a bypass around the winner', async () => {
    // Rapid double-tap race: run A is cancelled mid stretch-load; run B reuses
    // the source and builds the real chain. When A's engine init settles LATE,
    // its safety reroute must NOT fire — a source→destination edge added here
    // is a permanent unmuted dry path around B's shifter (original + shifted
    // pitch audible together — the "transpose sounds messed up" bug).
    let resolveA;
    h.factory.mockImplementationOnce(() => new Promise((r) => { resolveA = r; }));
    const el = video();
    const { rerender } = renderHook(({ s }) => useKeyShift(el, s), { initialProps: { s: 1 } });
    await waitFor(() => expect(h.factory).toHaveBeenCalledTimes(1)); // A in flight, source captured
    rerender({ s: 2 }); // cancels A; B starts and wins with the default instant factory
    await waitFor(() => expect(h.state.stretches.length).toBe(1));
    const source = lastCtx().createMediaElementSource.mock.results.at(-1).value;
    const destEdges = () => source.connect.mock.calls.filter((c) => c[0] === lastCtx().destination).length;
    const before = destEdges();
    resolveA(h.makeStretch()); // A settles late — cancelled AND superseded
    await settle();
    expect(destEdges()).toBe(before); // no stray dry edge around B's chain
    // B's chain still owns the element and keeps scheduling normally.
    await waitFor(() => expect(lastSchedule(h.state.stretches[0])).toMatchObject({ active: true, semitones: 2 }));
  });

  it('teardown stops the stretch and reroutes the source straight to the destination', async () => {
    const el = video();
    const { unmount } = renderHook(() => useKeyShift(el, 2));
    await waitFor(() => expect(h.state.stretches.length).toBe(1));
    const source = lastCtx().createMediaElementSource.mock.results[0].value;
    unmount();
    expect(h.state.stretches[0].stop).toHaveBeenCalled();
    // A captured element can never leave the graph — if it outlives this hook
    // it must keep sounding, so the source gets a direct edge to the speakers.
    expect(source.disconnect).toHaveBeenCalled();
    expect(source.connect).toHaveBeenLastCalledWith(lastCtx().destination);
  });

  it('reroutes the captured source to the speakers and reports failure when the engine rejects', async () => {
    h.factory.mockRejectedValueOnce(new Error('engine exploded'));
    const el = video();
    const { result } = renderHook(() => useKeyShift(el, 2));
    await waitFor(() => expect(result.current).toBe(true));
    const source = lastCtx().createMediaElementSource.mock.results.at(-1).value;
    // Fail AUDIBLE: captured-but-chainless audio must be wired to the speakers.
    expect(source.disconnect).toHaveBeenCalled();
    expect(source.connect).toHaveBeenLastCalledWith(lastCtx().destination);
    expect(h.state.stretches.length).toBe(0);
  });

  it('a hung engine init rejects at the timeout instead of pending forever', async () => {
    vi.useFakeTimers();
    try {
      h.factory.mockImplementationOnce(() => new Promise(() => {})); // never settles
      const el = video();
      const { result } = renderHook(() => useKeyShift(el, 1));
      // act() flushes the setEngineFailed(true) React schedules once the
      // race's timeout promise rejects mid-advance — without it the assertion
      // below can observe the pre-update render (a real flake, not a fake one).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STRETCH_INIT_TIMEOUT_MS + 100);
      });
      expect(result.current).toBe(true);
      const source = lastCtx().createMediaElementSource.mock.results.at(-1).value;
      expect(source.connect).toHaveBeenLastCalledWith(lastCtx().destination);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a stale cancelled run rejecting late does not disable an already-healthy current chain', async () => {
    const el = video();
    let rejectStaleRun;
    // Run A's engine call parks forever until we reject it ourselves, well
    // after it has been superseded.
    h.factory.mockImplementationOnce(() => new Promise((_, reject) => { rejectStaleRun = reject; }));
    const { result, rerender } = renderHook(({ s }) => useKeyShift(el, s), { initialProps: { s: 1 } });
    await waitFor(() => expect(h.factory).toHaveBeenCalledTimes(1));
    // Tapping again before run A settles cancels it (effect cleanup) and
    // starts run B, which reuses the cached source and succeeds via the
    // default factory — a healthy chain for this element now exists.
    rerender({ s: 2 });
    await waitFor(() => expect(h.state.stretches.length).toBe(1));
    await waitFor(() => expect(lastSchedule(h.state.stretches[0])).toMatchObject({ semitones: 2 }));
    expect(result.current).toBe(false);
    const source = lastCtx().createMediaElementSource.mock.results.at(-1).value;
    const destinationConnectsBefore = source.connect.mock.calls
      .filter((args) => args[0] === lastCtx().destination).length;
    // Run A's abandoned init finally settles as a rejection (e.g. its leaked
    // 6s init-timeout eventually firing). It was cancelled before run B ever
    // built anything, so this must be a no-op: no reroute of the now-healthy
    // source, and the stepper must not be disabled for audio that works.
    await act(async () => {
      rejectStaleRun(new Error('stale engine explosion'));
      await settle();
    });
    expect(result.current).toBe(false);
    const destinationConnectsAfter = source.connect.mock.calls
      .filter((args) => args[0] === lastCtx().destination).length;
    expect(destinationConnectsAfter).toBe(destinationConnectsBefore);
  });
});
