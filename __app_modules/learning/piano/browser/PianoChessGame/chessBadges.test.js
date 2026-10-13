import { describe, expect, it } from 'vitest';
import { DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';
import { createChessGameState, applySquare, destinationsFor } from './chessGameState.js';
import { destinationBadges } from './chessBadges.js';

const fresh = () => createChessGameState({
  playerColor: 'w', scheme: DEFAULT_CHORD_SCHEME, seed: 7, shuffleEachTurn: false,
});

describe('destinationBadges', () => {
  it('is empty when no piece is in hand', () => {
    expect(destinationBadges(fresh(), DEFAULT_CHORD_SCHEME)).toEqual({});
  });

  it('names every square the held piece can reach', () => {
    const start = fresh();
    // Pick up a knight, which always has moves from the opening position.
    const knightSquare = 'g1';
    const { state } = applySquare(start, knightSquare);
    expect(state.origin).toBe(knightSquare); // the pick-up actually happened
    const badges = destinationBadges(state, state.scheme);
    const squares = Object.keys(badges).sort();
    // A knight on g1 reaches exactly f3 and h3 from the opening position.
    expect(squares).toEqual(destinationsFor(state, knightSquare).slice().sort());
    expect(squares.length).toBeGreaterThan(0);
    for (const sq of squares) expect(typeof badges[sq]).toBe('string');
  });

  it('gives each destination the chord that actually addresses it', () => {
    const start = fresh();
    const { state } = applySquare(start, 'g1');
    const badges = destinationBadges(state, state.scheme);
    for (const [square, symbol] of Object.entries(badges)) {
      expect(symbol).toBe(squareToChord(square, state.scheme).symbol);
    }
  });
});
