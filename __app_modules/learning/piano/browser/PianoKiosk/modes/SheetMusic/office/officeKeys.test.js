import { describe, it, expect } from 'vitest';
import { piecePage, PIECE_NOTES, PAGE_NOTES, STRIP_KEYS, STRIP_NOTES, stripSlots, noteName } from './officeKeys.js';
import { SECONDARY_NOTES } from '../../../../game-platform/input/useNoteSelection.js';

const pieces = (n) => Array.from({ length: n }, (_, i) => ({ scoreId: `files:p${i}.mxl` }));

describe('piecePage (the piece picker binding)', () => {
  it('binds the newest pieces to the white keys from middle C, in order', () => {
    const page = piecePage(pieces(3));
    expect(page.slots.map((slot) => [slot.item.scoreId, slot.noteName])).toEqual([
      ['files:p0.mxl', 'C4'], ['files:p1.mxl', 'D4'], ['files:p2.mxl', 'E4'],
    ]);
    // One page needs no page keys.
    expect(page.pageCount).toBe(1);
    expect(page.pageSlots).toEqual([]);
  });

  it('pages on the octave below when there are more pieces than piece keys', () => {
    const first = piecePage(pieces(PIECE_NOTES.length + 3), 0);
    expect(first.pageCount).toBe(2);
    expect(first.slots).toHaveLength(PIECE_NOTES.length);
    expect(first.pageSlots.map((slot) => [slot.noteName, slot.item.label, slot.current])).toEqual([
      ['C3', 'Page 1', true], ['D3', 'Page 2', false],
    ]);
    const second = piecePage(pieces(PIECE_NOTES.length + 3), 1);
    // The second page starts again from C4, so a piece key always means "the nth piece shown".
    expect(second.slots.map((slot) => [slot.item.scoreId, slot.noteName])).toEqual([
      [`files:p${PIECE_NOTES.length}.mxl`, 'C4'], [`files:p${PIECE_NOTES.length + 1}.mxl`, 'D4'], [`files:p${PIECE_NOTES.length + 2}.mxl`, 'E4'],
    ]);
    expect(second.pageSlots.find((slot) => slot.current).noteName).toBe('D3');
  });

  it('page keys and piece keys never share a note', () => {
    const { slots, pageSlots } = piecePage(pieces(40));
    const pieceNotes = new Set(slots.map((slot) => slot.note));
    expect(pageSlots.some((slot) => pieceNotes.has(slot.note))).toBe(false);
    expect(PAGE_NOTES).toBe(SECONDARY_NOTES);
  });

  it('clamps a page past the end, and reports pieces no page key can reach', () => {
    const many = pieces(PIECE_NOTES.length * PAGE_NOTES.length + 5);
    const page = piecePage(many, 99);
    expect(page.page).toBe(PAGE_NOTES.length - 1);
    expect(page.unreachable).toBe(5);
    expect(piecePage(pieces(2), -3).page).toBe(0);
  });

  it('tolerates no pieces', () => {
    expect(piecePage(null)).toMatchObject({ page: 0, pageCount: 1, slots: [], pageSlots: [], unreachable: 0 });
  });
});

describe('stripSlots (the drill key strip)', () => {
  it('gives every action its own fixed key in the octave under the page keys', () => {
    expect(STRIP_KEYS.map((key) => [key.id, noteName(key.note)])).toEqual([
      ['pieces', 'C2'], ['previous', 'D2'], ['next', 'E2'], ['retry', 'F2'], ['later', 'G2'], ['listen', 'A2'],
    ]);
    expect(Math.max(...STRIP_NOTES)).toBeLessThan(Math.min(...SECONDARY_NOTES));
  });

  it('draws an action with nothing to do now on its own key, disabled', () => {
    const slots = stripSlots({ pieces: { onSelect: () => {} } });
    expect(slots.map((slot) => [slot.id, slot.enabled])).toEqual([
      ['pieces', true], ['previous', false], ['next', false], ['retry', false], ['later', false],
    ]);
  });

  it('hides Listen without a way to sound notes, and shows it with one', () => {
    expect(stripSlots({ listen: { onSelect: () => {} } }).some((slot) => slot.id === 'listen')).toBe(false);
    const listen = stripSlots({ listen: { onSelect: () => {}, label: 'Stop' } }, { canListen: true }).find((slot) => slot.id === 'listen');
    expect(listen).toMatchObject({ noteName: 'A2', label: 'Stop', enabled: true });
  });

  it('takes the label the action gives (Skip rhythm on the later key)', () => {
    expect(stripSlots({ later: { label: 'Skip rhythm', onSelect: () => {} } }).find((slot) => slot.id === 'later').label).toBe('Skip rhythm');
  });
});
