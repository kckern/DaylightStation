import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { bindNoteSlots, useNoteSelection, SELECTION_NOTES } from './useNoteSelection.js';

const notes = (...n) => new Map(n.map((x) => [x, { velocity: 100, timestamp: 1 }]));
const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `item-${i}` }));

describe('bindNoteSlots', () => {
  it('pairs each item with the next white key and names it', () => {
    const { slots } = bindNoteSlots(items(3));
    expect(slots.map((s) => s.note)).toEqual([60, 62, 64]);
    expect(slots.map((s) => s.noteName)).toEqual(['C4', 'D4', 'E4']);
  });

  it('reports items past the ladder rather than pretending they are reachable', () => {
    const { slots, dropped } = bindNoteSlots(items(SELECTION_NOTES.length + 3));
    expect(slots).toHaveLength(SELECTION_NOTES.length);
    expect(dropped).toHaveLength(3);
  });

  it('tolerates a missing list', () => {
    expect(bindNoteSlots(null).slots).toEqual([]);
  });
});

describe('useNoteSelection', () => {
  const setup = (enabled = true) => {
    const onSelect = vi.fn();
    const { slots } = bindNoteSlots(items(3));
    const hook = renderHook(
      ({ activeNotes }) => useNoteSelection({ activeNotes, slots, enabled, onSelect }),
      { initialProps: { activeNotes: notes() } },
    );
    return { ...hook, onSelect };
  };

  it('selects the item whose key was played', () => {
    const { rerender, onSelect } = setup();
    rerender({ activeNotes: notes(62) });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toEqual({ id: 'item-1' });
  });

  it('ignores a key that was already down when the list appeared', () => {
    // The key that opened the list must not answer it.
    const onSelect = vi.fn();
    const { slots } = bindNoteSlots(items(3));
    const { rerender } = renderHook(
      ({ activeNotes }) => useNoteSelection({ activeNotes, slots, enabled: true, onSelect }),
      { initialProps: { activeNotes: notes(60) } },
    );
    rerender({ activeNotes: notes(60) });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores keys that map to nothing', () => {
    const { rerender, onSelect } = setup();
    rerender({ activeNotes: notes(61) });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does nothing when disabled — a touch screen keeps its own affordance', () => {
    const { rerender, onSelect } = setup(false);
    rerender({ activeNotes: notes(60) });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('takes the lowest of a chord, so a smear picks one item not several', () => {
    const { rerender, onSelect } = setup();
    rerender({ activeNotes: notes(64, 60, 62) });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toEqual({ id: 'item-0' });
  });
});
