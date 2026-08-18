import { describe, it, expect } from 'vitest';
import { LAUNCHER_NOTES, buildLauncherSlots, slotForNote } from './launcherNotes.js';

const game = (id, status = 'released') => ({ id, label: id.toUpperCase(), icon: `game-${id}`, status });

describe('LAUNCHER_NOTES', () => {
  it('is the nine white keys from middle C to D5', () => {
    expect(LAUNCHER_NOTES).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74]);
  });
});

describe('buildLauncherSlots', () => {
  it('binds released games to notes in registry order, starting at middle C', () => {
    const { slots } = buildLauncherSlots([game('a'), game('b'), game('c')]);
    expect(slots.map(s => s.gameId)).toEqual(['a', 'b', 'c']);
    expect(slots.map(s => s.note)).toEqual([60, 62, 64]);
    expect(slots.map(s => s.noteName)).toEqual(['C4', 'D4', 'E4']);
  });

  it('omits games that are not released, and does not leave a gap in the notes', () => {
    const { slots } = buildLauncherSlots([game('a'), game('b', 'preview'), game('c')]);
    expect(slots.map(s => s.gameId)).toEqual(['a', 'c']);
    expect(slots.map(s => s.note)).toEqual([60, 62]);
  });

  it('carries the label and icon through for rendering', () => {
    const { slots } = buildLauncherSlots([game('tetris')]);
    expect(slots[0]).toMatchObject({ label: 'TETRIS', icon: 'game-tetris' });
  });

  it('marks which keys have a black key after them, from the note math', () => {
    const { slots } = buildLauncherSlots(Array.from({ length: 9 }, (_, i) => game(`g${i}`)));
    // C D E F G A B C D -> sharps after C, D, F, G, A, C. None after E or B.
    expect(slots.map(s => s.sharpAfter))
      .toEqual([true, true, false, true, true, true, false, true, false]);
  });

  it('drops games past the ninth and reports them rather than truncating silently', () => {
    const { slots, dropped } = buildLauncherSlots(
      Array.from({ length: 11 }, (_, i) => game(`g${i}`))
    );
    expect(slots).toHaveLength(9);
    expect(dropped).toEqual(['g9', 'g10']);
  });

  it('handles an empty registry without throwing', () => {
    expect(buildLauncherSlots([])).toEqual({ slots: [], dropped: [] });
    expect(buildLauncherSlots(null)).toEqual({ slots: [], dropped: [] });
  });
});

describe('slotForNote', () => {
  const { slots } = buildLauncherSlots([game('a'), game('b')]);

  it('finds the slot bound to a note', () => {
    expect(slotForNote(slots, 62)?.gameId).toBe('b');
  });

  it('returns null for a note no slot is bound to', () => {
    expect(slotForNote(slots, 61)).toBeNull();  // C#4 — a black key
    expect(slotForNote(slots, 64)).toBeNull();  // E4 — in range, but only 2 slots exist
    expect(slotForNote(slots, 21)).toBeNull();  // a combo key
  });
});
