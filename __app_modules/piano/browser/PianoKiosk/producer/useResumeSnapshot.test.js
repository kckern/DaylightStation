/**
 * useResumeSnapshot — localStorage resume net tests (Task 8.2).
 *
 * jsdom provides localStorage; each test starts from a clean store. Date.now is
 * pinned so recency math is deterministic. The hook is driven by re-rendering
 * with new { isPlaying, bar } props (the throttle clock).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useResumeSnapshot,
  SNAPSHOT_KEY,
  SCHEMA_VERSION,
  SNAPSHOT_EVERY_BARS,
} from './useResumeSnapshot.js';

const NOW = 1_700_000_000_000;

const workspace = (layers = []) => ({ layers, keyShift: 0, bpm: 100, metronome: false });
const takeLayer = (id) => ({
  id, role: 'bass', channel: 1, gain: 1,
  source: { kind: 'take', takeId: id, notes: [{ ticks: 0, durationTicks: 480, midi: 40 }], ppq: 480, lengthBars: 2 },
});

function writeStored(obj) {
  localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(obj));
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ── throttled write ───────────────────────────────────────────────────────────
describe('throttled write while playing', () => {
  it('writes on the rising play edge and every SNAPSHOT_EVERY_BARS thereafter', () => {
    const getState = () => ({ workspace: workspace([takeLayer('t1')]), draft: null, notesById: {} });
    const { rerender } = renderHook(
      ({ isPlaying, bar }) => useResumeSnapshot({ getState, isPlaying, bar }),
      { initialProps: { isPlaying: false, bar: 0 } },
    );
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();

    // Rising edge (bar 0) writes immediately.
    rerender({ isPlaying: true, bar: 0 });
    const first = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    expect(first.workspace.layers).toHaveLength(1);
    expect(first.version).toBe(SCHEMA_VERSION);

    // Within the same 4-bar bucket → no new write.
    localStorage.removeItem(SNAPSHOT_KEY);
    rerender({ isPlaying: true, bar: SNAPSHOT_EVERY_BARS - 1 });
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();

    // Crossing into the next bucket → writes again.
    rerender({ isPlaying: true, bar: SNAPSHOT_EVERY_BARS });
    expect(localStorage.getItem(SNAPSHOT_KEY)).not.toBeNull();
  });

  it('does not write while stopped', () => {
    const getState = () => ({ workspace: workspace([takeLayer('t1')]), draft: null });
    const { rerender } = renderHook(
      ({ isPlaying, bar }) => useResumeSnapshot({ getState, isPlaying, bar }),
      { initialProps: { isPlaying: false, bar: 0 } },
    );
    rerender({ isPlaying: false, bar: 8 });
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  it('embeds take notes in the snapshot (they cannot re-fetch)', () => {
    const getState = () => ({ workspace: workspace([takeLayer('t1')]), draft: null, notesById: {} });
    const { rerender } = renderHook(
      ({ isPlaying, bar }) => useResumeSnapshot({ getState, isPlaying, bar }),
      { initialProps: { isPlaying: false, bar: 0 } },
    );
    rerender({ isPlaying: true, bar: 0 });
    const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
    expect(snap.workspace.layers[0].source.notes).toEqual([{ ticks: 0, durationTicks: 480, midi: 40 }]);
  });
});

// ── mount detection ───────────────────────────────────────────────────────────
describe('mount detection', () => {
  it('offers a recent non-trivial snapshot', () => {
    writeStored({ version: SCHEMA_VERSION, ts: NOW - 1000, workspace: workspace([takeLayer('t1')]), draft: null });
    const { result } = renderHook(() => useResumeSnapshot({ getState: () => null, isPlaying: false, bar: 0 }));
    expect(result.current.hasResume).toBe(true);
    expect(result.current.resumeData.workspace.layers).toHaveLength(1);
  });

  it('ignores a stale snapshot (older than maxAge)', () => {
    writeStored({ version: SCHEMA_VERSION, ts: NOW - (25 * 60 * 60 * 1000), workspace: workspace([takeLayer('t1')]), draft: null });
    const { result } = renderHook(() => useResumeSnapshot({ getState: () => null, isPlaying: false, bar: 0 }));
    expect(result.current.hasResume).toBe(false);
  });

  it('ignores a version mismatch', () => {
    writeStored({ version: 99, ts: NOW, workspace: workspace([takeLayer('t1')]), draft: null });
    const { result } = renderHook(() => useResumeSnapshot({ getState: () => null, isPlaying: false, bar: 0 }));
    expect(result.current.hasResume).toBe(false);
  });

  it('ignores a trivial snapshot (no layers, no sections)', () => {
    writeStored({ version: SCHEMA_VERSION, ts: NOW, workspace: workspace([]), draft: null });
    const { result } = renderHook(() => useResumeSnapshot({ getState: () => null, isPlaying: false, bar: 0 }));
    expect(result.current.hasResume).toBe(false);
  });

  it('treats corrupt JSON as no snapshot (no crash)', () => {
    localStorage.setItem(SNAPSHOT_KEY, '{not json');
    const { result } = renderHook(() => useResumeSnapshot({ getState: () => null, isPlaying: false, bar: 0 }));
    expect(result.current.hasResume).toBe(false);
  });
});

// ── apply / dismiss ───────────────────────────────────────────────────────────
describe('apply and dismiss', () => {
  it('applyResume returns the data and hides the chip', () => {
    writeStored({ version: SCHEMA_VERSION, ts: NOW, workspace: workspace([takeLayer('t1')]), draft: { sections: [{ id: 'sec-1' }] } });
    const { result } = renderHook(() => useResumeSnapshot({ getState: () => null, isPlaying: false, bar: 0 }));
    let data;
    act(() => { data = result.current.applyResume(); });
    expect(data.workspace.layers).toHaveLength(1);
    expect(data.draft.sections).toHaveLength(1);
    expect(result.current.hasResume).toBe(false);
  });

  it('dismiss clears the stored snapshot and hides the chip', () => {
    writeStored({ version: SCHEMA_VERSION, ts: NOW, workspace: workspace([takeLayer('t1')]), draft: null });
    const { result } = renderHook(() => useResumeSnapshot({ getState: () => null, isPlaying: false, bar: 0 }));
    expect(result.current.hasResume).toBe(true);
    act(() => { result.current.dismiss(); });
    expect(result.current.hasResume).toBe(false);
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });

  it('clear is an alias for dismiss', () => {
    writeStored({ version: SCHEMA_VERSION, ts: NOW, workspace: workspace([takeLayer('t1')]), draft: null });
    const { result } = renderHook(() => useResumeSnapshot({ getState: () => null, isPlaying: false, bar: 0 }));
    act(() => { result.current.clear(); });
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });
});

// ── robustness ────────────────────────────────────────────────────────────────
describe('robustness', () => {
  it('swallows a quota error on write (setItem throws)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
    });
    const getState = () => ({ workspace: workspace([takeLayer('t1')]), draft: null });
    const { rerender } = renderHook(
      ({ isPlaying, bar }) => useResumeSnapshot({ getState, isPlaying, bar }),
      { initialProps: { isPlaying: false, bar: 0 } },
    );
    expect(() => rerender({ isPlaying: true, bar: 0 })).not.toThrow();
    spy.mockRestore();
  });

  it('does not write when getState throws', () => {
    const getState = () => { throw new Error('boom'); };
    const { rerender } = renderHook(
      ({ isPlaying, bar }) => useResumeSnapshot({ getState, isPlaying, bar }),
      { initialProps: { isPlaying: false, bar: 0 } },
    );
    expect(() => rerender({ isPlaying: true, bar: 0 })).not.toThrow();
    expect(localStorage.getItem(SNAPSHOT_KEY)).toBeNull();
  });
});
