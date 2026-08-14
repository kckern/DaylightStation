import { describe, expect, it } from 'vitest';
import { resolveAddressedSelection } from '../game-platform/families/addressed-board/interactionGrammars.js';
import { noteName, shuffledSquares, squareForNotes } from './PianoCheckers.jsx';

describe('Piano Checkers addressing', () => {
  it('maps exact piano notes through the current deal', () => {
    const active = new Map([[49, { velocity: 100 }]]);
    const config = { square_notes: Array.from({ length: 32 }, (_, index) => 48 + index) };
    expect(squareForNotes(active, config, [31, ...Array.from({ length: 31 }, (_, index) => index)])).toBe(0);
  });

  it('deals each square exactly once and deterministically', () => {
    expect(shuffledSquares(7)).toEqual(shuffledSquares(7));
    expect([...shuffledSquares(7)].sort((a, b) => a - b)).toEqual(Array.from({ length: 32 }, (_, index) => index));
  });

  it('uses the addressed-board source/destination grammar', () => {
    expect(resolveAddressedSelection({ selected: null, address: 20, sources: [20], destinations: [] })).toEqual({ selected: 20, committed: null, rejection: null });
    expect(resolveAddressedSelection({ selected: 20, address: 16, sources: [20], destinations: [16, 17] })).toEqual({ selected: null, committed: { from: 20, to: 16 }, rejection: null });
    expect(noteName(60)).toBe('C4');
  });
});
