import { describe, it, expect } from 'vitest';
import { listPage, browseSlots, PIECE_NOTES, SHELF_NOTES, STRIP_KEYS, STRIP_NOTES, stripSlots, noteName } from './officeKeys.js';
import { SECONDARY_NOTES } from '../../../../game-platform/input/useNoteSelection.js';

const pieces = (n) => Array.from({ length: n }, (_, i) => ({ scoreId: `files:p${i}.mxl` }));

describe('listPage (six pieces a page)', () => {
  it('binds a page to the white keys from middle C, in order', () => {
    const page = listPage(pieces(3));
    expect(page.slots.map((slot) => [slot.item.scoreId, slot.noteName])).toEqual([
      ['files:p0.mxl', 'C4'], ['files:p1.mxl', 'D4'], ['files:p2.mxl', 'E4'],
    ]);
    expect(page).toMatchObject({ page: 0, pageCount: 1, hasPrevious: false, hasNext: false });
  });

  it('shows six at a time and reaches every piece of a long shelf by Next', () => {
    expect(PIECE_NOTES.map(noteName)).toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4']);
    const list = pieces(40);
    const seen = [];
    for (let at = 0; ; at += 1) {
      const page = listPage(list, at);
      seen.push(...page.slots.map((slot) => slot.item.scoreId));
      if (!page.hasNext) break;
    }
    expect(seen).toEqual(list.map((piece) => piece.scoreId));
    const second = listPage(list, 1);
    // Every page starts again from C4, so a key always means "the nth piece shown".
    expect(second.slots[0]).toMatchObject({ noteName: 'C4', item: { scoreId: 'files:p6.mxl' } });
    expect(second).toMatchObject({ hasPrevious: true, hasNext: true, pageCount: 7 });
  });

  it('clamps a page out of range and tolerates no list', () => {
    expect(listPage(pieces(8), 99).page).toBe(1);
    expect(listPage(pieces(2), -3).page).toBe(0);
    expect(listPage(null)).toMatchObject({ page: 0, pageCount: 1, slots: [], hasPrevious: false, hasNext: false });
  });

  it('binds shelves C4 to C5', () => {
    expect(listPage(pieces(8), 0, SHELF_NOTES).slots.map((slot) => slot.noteName))
      .toEqual(['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']);
  });
});

describe('browseSlots (the keys under a list)', () => {
  it('keeps each browse action on its own key in the octave below, dim when it does nothing', () => {
    const row = browseSlots('shelf', { hasPrevious: false, hasNext: true });
    expect(row.map((slot) => [slot.id, slot.noteName, slot.label, slot.enabled])).toEqual([
      ['switch', 'C3', 'All music', true], ['previous', 'D3', 'Previous', false], ['next', 'E3', 'Next', true],
    ]);
    expect(browseSlots('shelves')[0].label).toBe('Your pieces');
    expect(row.every((slot) => SECONDARY_NOTES.includes(slot.note))).toBe(true);
    expect(row.some((slot) => SHELF_NOTES.includes(slot.note))).toBe(false);
  });

  it('with no pieces of their own, the shelves offer no way back to an empty list', () => {
    expect(browseSlots('shelves', {}, { hasOwn: false })[0]).toMatchObject({ id: 'switch', enabled: false });
    expect(browseSlots('shelves', {}, { hasOwn: true })[0]).toMatchObject({ id: 'switch', enabled: true });
    // From a shelf, C3 still goes back to the shelves.
    expect(browseSlots('shelf', {}, { hasOwn: false })[0]).toMatchObject({ id: 'switch', label: 'All music', enabled: true });
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
