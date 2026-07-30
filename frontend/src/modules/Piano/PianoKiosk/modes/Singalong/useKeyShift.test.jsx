// useKeyShift.test.jsx — Web Audio key-shift chain lifecycle.
//
// The hook owns the one delicate Web Audio invariant: createMediaElementSource
// is ONE-SHOT per element (a second call throws, and once called the element's
// audio flows only through the graph). These tests pin the lifecycle around
// that: lazy build, per-element source caching, wet-bypass at natural key,
// rebuild on element swap, dispose on unmount. `tone` is mocked — jsdom has no
// AudioContext — so assertions target the graph calls, not audible output.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import useKeyShift from './useKeyShift.js';

const h = vi.hoisted(() => {
  const created = [];
  class FakePitchShift {
    constructor(opts = {}) {
      this.opts = opts;
      this.pitch = opts.pitch ?? 0;
      this.wet = { value: opts.wet ?? 1 };
      this.disposed = false;
      created.push(this);
    }

    toDestination() { return this; }

    dispose() { this.disposed = true; }
  }
  const ctx = {
    createMediaElementSource: vi.fn(() => ({})),
    resume: vi.fn(() => Promise.resolve()),
  };
  return {
    created,
    FakePitchShift,
    ctx,
    connect: vi.fn(),
    start: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('tone', () => ({
  PitchShift: h.FakePitchShift,
  getContext: () => h.ctx,
  connect: h.connect,
  start: h.start,
}));

const video = () => document.createElement('video');
const settle = () => new Promise((r) => setTimeout(r, 25));

beforeEach(() => {
  h.created.length = 0;
  h.ctx.createMediaElementSource.mockClear();
  h.connect.mockClear();
  h.start.mockClear();
});

describe('useKeyShift', () => {
  it('does not touch the audio graph while the key is natural', async () => {
    const el = video();
    renderHook(() => useKeyShift(el, 0));
    await settle();
    expect(h.ctx.createMediaElementSource).not.toHaveBeenCalled();
    expect(h.created.length).toBe(0);
  });

  it('builds source → PitchShift → destination on the first shift', async () => {
    const el = video();
    const { rerender } = renderHook(({ s }) => useKeyShift(el, s), { initialProps: { s: 0 } });
    rerender({ s: 2 });
    await waitFor(() => expect(h.created.length).toBe(1));
    expect(h.ctx.createMediaElementSource).toHaveBeenCalledWith(el);
    expect(h.connect).toHaveBeenCalled();
    await waitFor(() => expect(h.created[0].pitch).toBe(2));
    expect(h.created[0].wet.value).toBe(1);
  });

  it('bypasses (wet 0) at natural key without rebuilding the chain', async () => {
    const el = video();
    const { rerender } = renderHook(({ s }) => useKeyShift(el, s), { initialProps: { s: 1 } });
    await waitFor(() => expect(h.created.length).toBe(1));
    rerender({ s: 0 });
    await waitFor(() => expect(h.created[0].wet.value).toBe(0));
    expect(h.created[0].pitch).toBe(0);
    expect(h.created.length).toBe(1);
    expect(h.ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it('never creates a second source for the same element', async () => {
    const el = video();
    const { rerender } = renderHook(({ s }) => useKeyShift(el, s), { initialProps: { s: 1 } });
    await waitFor(() => expect(h.created.length).toBe(1));
    rerender({ s: 2 });
    rerender({ s: 3 });
    await waitFor(() => expect(h.created[0].pitch).toBe(3));
    expect(h.ctx.createMediaElementSource).toHaveBeenCalledTimes(1);
  });

  it('waits for a media element, then applies the pending shift', async () => {
    const { rerender } = renderHook(({ el }) => useKeyShift(el, 3), { initialProps: { el: null } });
    await settle();
    expect(h.created.length).toBe(0);
    const el = video();
    rerender({ el });
    await waitFor(() => expect(h.created.length).toBe(1));
    await waitFor(() => expect(h.created[0].pitch).toBe(3));
  });

  it('rebuilds on media element swap, disposing the old shifter', async () => {
    const elA = video();
    const elB = video();
    const { rerender } = renderHook(({ el }) => useKeyShift(el, 2), { initialProps: { el: elA } });
    await waitFor(() => expect(h.created.length).toBe(1));
    rerender({ el: elB });
    await waitFor(() => expect(h.created.length).toBe(2));
    expect(h.created[0].disposed).toBe(true);
    expect(h.ctx.createMediaElementSource).toHaveBeenCalledWith(elB);
    await waitFor(() => expect(h.created[1].pitch).toBe(2));
  });

  it('disposes the shifter on unmount', async () => {
    const el = video();
    const { unmount } = renderHook(() => useKeyShift(el, 2));
    await waitFor(() => expect(h.created.length).toBe(1));
    unmount();
    expect(h.created[0].disposed).toBe(true);
  });
});
