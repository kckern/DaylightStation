import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import rhythmLoopSitting from './__fixtures__/humanNotes/rhythm-loop-sitting.json';

const listeners = new Set();
const midi = { subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));

const log = { info: vi.fn(), sampled: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../../../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => log }),
}));

import { useHumanNotes, humanActiveNotes } from './useHumanNotes.js';

const T0 = 1_762_000_000_000;
const emit = (evt) => act(() => { for (const fn of listeners) fn(evt); });

beforeEach(() => {
  listeners.clear();
  Object.values(log).forEach((f) => f.mockReset());
});

describe('useHumanNotes', () => {
  it('a person playing moves humanNoteAt and holds the key until note-off', () => {
    const { result } = renderHook(() => useHumanNotes());
    expect(result.current.humanNoteAt).toBe(0);
    emit({ type: 'note_on', note: 60, velocity: 70, time: T0 });
    expect(result.current.humanNoteAt).toBeGreaterThan(0);
    expect([...result.current.humanHeld.keys()]).toEqual([60]);
    emit({ type: 'note_off', note: 60, velocity: 0, time: T0 + 300 });
    expect(result.current.humanHeld.size).toBe(0);
  });

  it('the rhythm loop alone stops moving humanNoteAt once recognised, and logs it (sampled)', () => {
    const { result } = renderHook(() => useHumanNotes({ context: { contentId: 'plex:1' } }));
    let atArm = null;
    for (const [ms, note, velocity] of rhythmLoopSitting.notes) {
      emit({ type: 'note_on', note, velocity, time: T0 + ms });
      if (ms > 50_000 && atArm === null) atArm = result.current.humanNoteAt;
    }
    expect(result.current.humanNoteAt).toBe(atArm);
    expect(log.info).toHaveBeenCalledWith('piano.presence.rhythm-loop',
      expect.objectContaining({ state: 'on', contentId: 'plex:1' }));
    expect(log.sampled).toHaveBeenCalledWith('piano.presence.note-filtered',
      expect.objectContaining({ reason: 'rhythm-loop' }), { maxPerMinute: 4, aggregate: true });
    expect([...result.current.loopPitches()]).toContain(42);
  });

  it('a percussion-channel note never counts', () => {
    const { result } = renderHook(() => useHumanNotes());
    emit({ type: 'note_on', note: 60, velocity: 70, time: T0, channel: 9 });
    expect(result.current.humanNoteAt).toBe(0);
    expect(result.current.humanHeld.size).toBe(0);
  });

  it('humanActiveNotes keeps only keys a person holds that the store still has down', () => {
    const store = new Map([[60, { v: 1 }], [62, { v: 1 }]]);
    const held = new Map([[60, 70], [72, 70]]);
    expect([...humanActiveNotes(store, held).keys()]).toEqual([60]);
  });
});
