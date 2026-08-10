import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTakePreview } from './useTakePreview.js';
import { PEEK_CHANNEL, PEEK_DRUM_CHANNEL } from './usePeek.js';

let now = 0;
let raf = new Map();
let nextId = 1;

beforeEach(() => {
  now = 0;
  raf = new Map();
  nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (cb) => { const id = nextId++; raf.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id) => raf.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function frameAt(ms) {
  now = ms;
  const callbacks = [...raf.values()];
  raf.clear();
  callbacks.forEach((cb) => cb(ms));
}

const router = () => ({
  noteOn: vi.fn(), noteOff: vi.fn(), allNotesOff: vi.fn(), configureLayer: vi.fn(),
});
const take = (over = {}) => ({
  takeId: 'take', kind: 'chords', ppq: 480, lengthBars: 1,
  notes: [{ ticks: 0, durationTicks: 480, midi: 60, velocity: 100 }],
  ...over,
});

describe('useTakePreview', () => {
  it('auditions canonical generated chords in the live target key, then releases them', () => {
    const r = router();
    const audio = vi.fn();
    const { result } = renderHook(() => useTakePreview({ router: r, bpm: 120, keyShift: 2, layers: [], onAudioGesture: audio }));
    act(() => { expect(result.current.previewTake(take())).toBe(true); });
    act(() => frameAt(0));
    expect(audio).toHaveBeenCalledTimes(1);
    expect(r.configureLayer).toHaveBeenCalledWith(PEEK_CHANNEL, { program: 0, gain: 1 });
    expect(r.noteOn).toHaveBeenCalledWith(PEEK_CHANNEL, 62, 90);
    act(() => frameAt(500));
    expect(r.noteOff).toHaveBeenCalledWith(PEEK_CHANNEL, 62);
  });

  it('keeps GM drum pitches fixed and uses the percussion channel', () => {
    const r = router();
    const { result } = renderHook(() => useTakePreview({ router: r, bpm: 120, keyShift: 7, layers: [] }));
    act(() => result.current.previewTake(take({ kind: 'groove', drumMode: true, notes: [{ ticks: 0, durationTicks: 120, midi: 36, velocity: 110 }] })));
    act(() => frameAt(0));
    expect(r.noteOn).toHaveBeenCalledWith(PEEK_DRUM_CHANNEL, 36, 99);
  });

  it('refuses a melodic preview when reserved channel 15 is already a live layer', () => {
    const r = router();
    const { result } = renderHook(() => useTakePreview({ router: r, bpm: 120, keyShift: 0, layers: [{ channel: 15 }] }));
    act(() => { expect(result.current.previewTake(take())).toBe(false); });
    expect(r.noteOn).not.toHaveBeenCalled();
    expect(result.current.isPreviewing).toBe(false);
  });

  it('manual Stop releases every active pitched note, panics the reserved channel, and kills its clock', () => {
    const r = router();
    const { result } = renderHook(() => useTakePreview({ router: r, bpm: 120, keyShift: 0, layers: [] }));
    act(() => result.current.previewTake(take()));
    act(() => frameAt(0));
    expect(r.noteOn).toHaveBeenCalledWith(PEEK_CHANNEL, 60, 90);

    act(() => result.current.stopPreview());
    expect(r.noteOff).toHaveBeenCalledWith(PEEK_CHANNEL, 60);
    expect(r.allNotesOff).toHaveBeenCalledWith(PEEK_CHANNEL);
    expect(result.current.isPreviewing).toBe(false);

    const before = r.noteOn.mock.calls.length;
    act(() => frameAt(5000));
    expect(r.noteOn).toHaveBeenCalledTimes(before);
  });

  it('manual Stop releases exact groove notes without blanket-wiping shared drum channel 9', () => {
    const r = router();
    const groove = take({
      kind: 'groove', drumMode: true,
      notes: [{ ticks: 0, durationTicks: 480, midi: 36, velocity: 110 }],
    });
    const { result } = renderHook(() => useTakePreview({ router: r, bpm: 120, keyShift: 0, layers: [] }));
    act(() => result.current.previewTake(groove));
    act(() => frameAt(0));

    act(() => result.current.stopPreview());
    expect(r.noteOff).toHaveBeenCalledWith(PEEK_DRUM_CHANNEL, 36);
    expect(r.allNotesOff).not.toHaveBeenCalledWith(PEEK_DRUM_CHANNEL);
  });

  it('unmount is an audible teardown: it releases a sounding preview immediately', () => {
    const r = router();
    const { result, unmount } = renderHook(() => useTakePreview({ router: r, bpm: 120, keyShift: 0, layers: [] }));
    act(() => result.current.previewTake(take()));
    act(() => frameAt(0));

    unmount();
    expect(r.noteOff).toHaveBeenCalledWith(PEEK_CHANNEL, 60);
    expect(r.allNotesOff).toHaveBeenCalledWith(PEEK_CHANNEL);
  });
});
