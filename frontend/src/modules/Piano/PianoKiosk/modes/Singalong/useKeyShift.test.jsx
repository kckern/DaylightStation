// useKeyShift.test.jsx — Web Audio key-shift chain lifecycle (Signalsmith Stretch).
//
// The hook owns the one delicate Web Audio invariant: createMediaElementSource
// is ONE-SHOT per element (a second call throws, and once called the element's
// audio flows only through the graph). These tests pin the lifecycle around
// that: lazy build, per-element source caching, zero-latency dry bypass at the
// natural key, rebuild on element swap, and safe teardown that reroutes a
// still-alive element straight to the speakers. The stretch engine and
// AudioContext are mocked — jsdom has no Web Audio — so assertions target the
// graph calls, not audible output.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useKeyShift from './useKeyShift.js';

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

vi.mock('signalsmith-stretch', () => ({ default: h.factory }));

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
});
