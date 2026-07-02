import { describe, it, expect, vi } from 'vitest';
import { createNoteTapFilter, makeLoopNotesTap } from './noteTapFilter.js';

describe('createNoteTapFilter', () => {
  it('passes only events on visible channels', () => {
    const filter = createNoteTapFilter({ visibleChannels: [0, 2] });
    expect(filter({ type: 'on', channel: 0, note: 60 })).toBe(true);
    expect(filter({ type: 'on', channel: 1, note: 60 })).toBe(false);
    expect(filter({ type: 'off', channel: 2, note: 60 })).toBe(true);
    expect(filter({ type: 'on', channel: 9, note: 36 })).toBe(false);
  });

  it('accepts a Set as well as an array', () => {
    const filter = createNoteTapFilter({ visibleChannels: new Set([5]) });
    expect(filter({ type: 'on', channel: 5, note: 60 })).toBe(true);
    expect(filter({ type: 'on', channel: 0, note: 60 })).toBe(false);
  });

  it('setVisibleChannels swaps the visible set (layers come and go)', () => {
    const filter = createNoteTapFilter({ visibleChannels: [0] });
    filter.setVisibleChannels([1]);
    expect(filter({ type: 'on', channel: 0, note: 60 })).toBe(false);
    expect(filter({ type: 'on', channel: 1, note: 60 })).toBe(true);
  });

  it('defaults to nothing visible', () => {
    const filter = createNoteTapFilter({});
    expect(filter({ type: 'on', channel: 0, note: 60 })).toBe(false);
  });
});

describe('makeLoopNotesTap', () => {
  it('adds a visible-channel note on "on" and calls onSet with the sounding set', () => {
    const onSet = vi.fn();
    const tap = makeLoopNotesTap({ visibleChannels: [0], onSet });
    tap({ type: 'on', channel: 0, note: 60 });
    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet.mock.calls[0][0]).toEqual(new Set([60]));
  });

  it('ignores notes on hidden channels (no onSet, no entry)', () => {
    const onSet = vi.fn();
    const tap = makeLoopNotesTap({ visibleChannels: [0], onSet });
    tap({ type: 'on', channel: 9, note: 36 });
    expect(onSet).not.toHaveBeenCalled();
  });

  it('removes on "off" and calls onSet with the shrunken set', () => {
    const onSet = vi.fn();
    const tap = makeLoopNotesTap({ visibleChannels: [0], onSet });
    tap({ type: 'on', channel: 0, note: 60 });
    tap({ type: 'on', channel: 0, note: 64 });
    tap({ type: 'off', channel: 0, note: 60 });
    expect(onSet).toHaveBeenCalledTimes(3);
    expect(onSet.mock.calls[2][0]).toEqual(new Set([64]));
  });

  it('passes a NEW Set instance on every change (React state identity)', () => {
    const sets = [];
    const tap = makeLoopNotesTap({ visibleChannels: [0], onSet: (s) => sets.push(s) });
    tap({ type: 'on', channel: 0, note: 60 });
    tap({ type: 'off', channel: 0, note: 60 });
    expect(sets).toHaveLength(2);
    expect(sets[0]).not.toBe(sets[1]);
    expect(sets[1]).toEqual(new Set());
  });

  it('"off" for a note that was never tracked does not call onSet', () => {
    const onSet = vi.fn();
    const tap = makeLoopNotesTap({ visibleChannels: [0], onSet });
    tap({ type: 'off', channel: 0, note: 60 });
    expect(onSet).not.toHaveBeenCalled();
  });

  it('retrigger of an already-sounding note does not emit a redundant set', () => {
    const onSet = vi.fn();
    const tap = makeLoopNotesTap({ visibleChannels: [0], onSet });
    tap({ type: 'on', channel: 0, note: 60 });
    tap({ type: 'on', channel: 0, note: 60 });
    expect(onSet).toHaveBeenCalledTimes(1);
  });

  it('same note held on two visible channels stays lit when one releases', () => {
    const onSet = vi.fn();
    const tap = makeLoopNotesTap({ visibleChannels: [0, 1], onSet });
    tap({ type: 'on', channel: 0, note: 60 });
    tap({ type: 'on', channel: 1, note: 60 });
    tap({ type: 'off', channel: 0, note: 60 });
    expect(onSet.mock.calls.at(-1)[0]).toEqual(new Set([60])); // still lit via channel 1
    tap({ type: 'off', channel: 1, note: 60 });
    expect(onSet.mock.calls.at(-1)[0]).toEqual(new Set());
  });

  describe('setVisibleChannels', () => {
    it('updates which channels feed the set going forward', () => {
      const onSet = vi.fn();
      const tap = makeLoopNotesTap({ visibleChannels: [0], onSet });
      tap.setVisibleChannels([1]);
      tap({ type: 'on', channel: 0, note: 60 });
      expect(onSet).not.toHaveBeenCalled();
      tap({ type: 'on', channel: 1, note: 62 });
      expect(onSet.mock.calls.at(-1)[0]).toEqual(new Set([62]));
    });

    it('prunes now-hidden channels\' sounding notes (removed layer must not leave keys lit)', () => {
      const onSet = vi.fn();
      const tap = makeLoopNotesTap({ visibleChannels: [0, 1], onSet });
      tap({ type: 'on', channel: 0, note: 60 });
      tap({ type: 'on', channel: 1, note: 64 });
      tap.setVisibleChannels([0]); // layer on channel 1 removed mid-note
      expect(onSet.mock.calls.at(-1)[0]).toEqual(new Set([60]));
    });

    it('emits a NEW Set when pruning, and does not emit when nothing was pruned', () => {
      const sets = [];
      const tap = makeLoopNotesTap({ visibleChannels: [0, 1], onSet: (s) => sets.push(s) });
      tap({ type: 'on', channel: 1, note: 64 });
      const before = sets.at(-1);
      tap.setVisibleChannels([0]); // prunes note 64
      expect(sets.at(-1)).not.toBe(before);
      expect(sets.at(-1)).toEqual(new Set());
      const count = sets.length;
      tap.setVisibleChannels([0, 2]); // nothing sounding is hidden → no emit
      expect(sets.length).toBe(count);
    });
  });
});
