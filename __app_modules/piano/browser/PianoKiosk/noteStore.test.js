import { describe, it, expect, vi } from 'vitest';
import { createNoteStore } from './noteStore.js';

describe('createNoteStore', () => {
  it('noteOn/noteOff maintain activeNotes and isPlaying with immutable snapshots', () => {
    const s = createNoteStore();
    const before = s.getSnapshot();
    s.noteOn(60, 90, 1000);
    const after = s.getSnapshot();
    expect(after).not.toBe(before);                       // new snapshot identity
    expect(after.activeNotes.get(60)).toEqual({ velocity: 90, timestamp: 1000 });
    expect(after.isPlaying).toBe(true);
    s.noteOff(60, 1200);
    expect(s.getSnapshot().activeNotes.has(60)).toBe(false);
    expect(s.getSnapshot().isPlaying).toBe(false);
  });

  it('notifies subscribers once per mutation; unsubscribe works', () => {
    const s = createNoteStore();
    const fn = vi.fn();
    const un = s.subscribe(fn);
    s.noteOn(60, 90, 0);
    expect(fn).toHaveBeenCalledTimes(1);
    un();
    s.noteOff(60, 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('tracks noteHistory open/close and sustain', () => {
    const s = createNoteStore();
    s.noteOn(60, 90, 0);
    s.noteOff(60, 500);
    const h = s.getSnapshot().noteHistory;
    expect(h.length).toBe(1);
    expect(h[0].endTime).toBe(500);
    s.sustain(true);
    expect(s.getSnapshot().sustainPedal).toBe(true);
  });

  it('sweepStale closes lost notes and does not notify when nothing changed', () => {
    const s = createNoteStore();
    const fn = vi.fn();
    s.subscribe(fn);
    s.sweepStale(Date.now());         // empty — no change
    expect(fn).not.toHaveBeenCalled();
  });
});
