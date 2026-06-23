import { describe, it, expect } from 'vitest';
import { noteToAction, NAV_KEYS, entriesFor, moveSelection } from './instrumentsKeyMap.js';

describe('noteToAction', () => {
  it('maps C2 (36) → prev', () => { expect(noteToAction(36)).toBe('prev'); });
  it('maps D2 (38) → next', () => { expect(noteToAction(38)).toBe('next'); });
  it('maps E2 (40) → activate', () => { expect(noteToAction(40)).toBe('activate'); });
  it('maps F2 (41) → panic', () => { expect(noteToAction(41)).toBe('panic'); });
  it('returns null for a non-nav note (60 / middle C)', () => { expect(noteToAction(60)).toBeNull(); });
  it('returns null for a near-but-not-nav note (37)', () => { expect(noteToAction(37)).toBeNull(); });
});

describe('NAV_KEYS', () => {
  it('exposes the four nav keys with note/action/label', () => {
    expect(NAV_KEYS).toEqual([
      { note: 36, action: 'prev', label: 'Prev' },
      { note: 38, action: 'next', label: 'Next' },
      { note: 40, action: 'activate', label: 'Select' },
      { note: 41, action: 'panic', label: 'Panic' },
    ]);
  });
  it('is the single source of truth for noteToAction', () => {
    for (const k of NAV_KEYS) expect(noteToAction(k.note)).toBe(k.action);
  });
});

describe('entriesFor', () => {
  it('prepends the Onboard entry to configured instruments', () => {
    const instruments = [{ id: 'grand', name: 'Grand', engine: 'sfizz' }];
    expect(entriesFor(instruments)).toEqual([
      { id: '__onboard__', name: 'Onboard', engine: null },
      { id: 'grand', name: 'Grand', engine: 'sfizz' },
    ]);
  });
  it('returns just Onboard for an empty instruments array', () => {
    expect(entriesFor([])).toEqual([{ id: '__onboard__', name: 'Onboard', engine: null }]);
  });
});

describe('moveSelection', () => {
  it('next wraps to 0 at the end', () => { expect(moveSelection(2, 'next', 3)).toBe(0); });
  it('next advances within bounds', () => { expect(moveSelection(0, 'next', 3)).toBe(1); });
  it('prev wraps to last from 0', () => { expect(moveSelection(0, 'prev', 3)).toBe(2); });
  it('prev decrements within bounds', () => { expect(moveSelection(2, 'prev', 3)).toBe(1); });
  it('is a no-op for a single entry', () => {
    expect(moveSelection(0, 'next', 1)).toBe(0);
    expect(moveSelection(0, 'prev', 1)).toBe(0);
  });
  it('is a no-op for non-nav actions', () => {
    expect(moveSelection(1, 'activate', 3)).toBe(1);
    expect(moveSelection(1, 'panic', 3)).toBe(1);
  });
  it('guards count<=0 → 0', () => {
    expect(moveSelection(2, 'next', 0)).toBe(0);
    expect(moveSelection(2, 'prev', -1)).toBe(0);
  });
});
