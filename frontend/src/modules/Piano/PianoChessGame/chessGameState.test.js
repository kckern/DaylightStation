import { describe, expect, it } from 'vitest';
import { DEFAULT_CHORD_SCHEME, squareToChord } from '@shared-gaming/chess/index.mjs';
import {
  applySquare, capturedPieces, commitMove, createChessGameState, destinationsFor, isPlayerTurn, pieceAt,
} from './chessGameState.js';
import { advanceCursor, createCursorState } from './chordCursor.js';

// e2 is the E-minor square, e4 the E-add2 square, under the default scheme.
const play = (state, ...squares) => squares.reduce((current, square) => applySquare(current, square).state, state);

describe('piano chess move flow', () => {
  it('starts with White to move and nothing selected', () => {
    const state = createChessGameState();
    expect(state.origin).toBe(null);
    expect(state.status.turn).toBe('w');
    expect(isPlayerTurn(state)).toBe(true);
    expect(pieceAt(state.game.fen, 'e2')).toBe('wP');
  });

  it('takes two chords to make a move', () => {
    const state = createChessGameState();
    const selected = applySquare(state, 'e2');
    expect(selected.event.type).toBe('selected');
    expect(selected.state.origin).toBe('e2');
    expect(selected.state.game.moves).toHaveLength(0);

    const moved = applySquare(selected.state, 'e4');
    expect(moved.event.type).toBe('moved');
    expect(moved.state.origin).toBe(null);
    expect(moved.state.game.moves).toEqual(['e4']);
    expect(moved.state.lastMove).toEqual({ from: 'e2', to: 'e4' });
  });

  it('records each move as the two chords that performed it', () => {
    const state = play(createChessGameState({ shuffleEachTurn: false }), 'e2', 'e4');
    expect(state.history[0].chords).toEqual(['Em', 'Eadd2']);
    expect(state.history[0].san).toBe('e4');
  });

  it('explains every refusal instead of doing nothing', () => {
    const state = createChessGameState();
    expect(applySquare(state, 'e5').event.reason).toBe('empty_square');
    expect(applySquare(state, 'e7').event.reason).toBe('not_your_piece');
    expect(applySquare(state, 'e1').event.reason).toBe('piece_is_stuck');
    expect(applySquare(state, null).event.reason).toBe('unrecognised_chord');

    const selected = applySquare(state, 'e2').state;
    expect(applySquare(selected, 'e5').event.reason).toBe('illegal_destination');
    expect(selected.rejection).toBe(null);
  });

  it('lets the player change their mind', () => {
    const selected = applySquare(createChessGameState(), 'e2').state;
    expect(applySquare(selected, 'e2').event.type).toBe('deselected');
    const reselected = applySquare(selected, 'd2');
    expect(reselected.event.type).toBe('selected');
    expect(reselected.state.origin).toBe('d2');
  });

  it('refuses input when it is not the playerturn', () => {
    const afterWhite = play(createChessGameState(), 'e2', 'e4');
    expect(isPlayerTurn(afterWhite)).toBe(false);
    expect(applySquare(afterWhite, 'd2').event.reason).toBe('not_your_turn');
  });

  it('offers only the legal destinations', () => {
    const state = createChessGameState();
    expect(destinationsFor(state, 'e2').sort()).toEqual(['e3', 'e4']);
    expect(destinationsFor(state, 'g1').sort()).toEqual(['f3', 'h3']);
    expect(destinationsFor(state, 'e5')).toEqual([]);
  });

  it('tallies captures to the side that made them', () => {
    let state = createChessGameState();
    state = commitMove(state, 'e2', 'e4').state;
    state = commitMove(state, 'd7', 'd5').state;
    state = commitMove(state, 'e4', 'd5').state;
    expect(state.history.at(-1).captured).toBe('p');
    expect(capturedPieces(state.history)).toEqual({ w: ['p'], b: [] });
  });

  it('ends the game on checkmate and stops accepting chords', () => {
    let state = createChessGameState();
    for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
      state = commitMove(state, from, to).state;
    }
    expect(state.status.game_over).toBe(true);
    expect(state.status.outcome).toBe('checkmate');
    expect(state.status.winner).toBe('b');
    expect(applySquare(state, 'e2').event.reason).toBe('game_over');
  });
});

describe('the chord map re-deals each turn', () => {
  it('holds steady across both chords of one move', () => {
    const state = createChessGameState({ seed: 4 });
    const selected = applySquare(state, 'e2').state;
    // Selecting must not re-deal — the player reads one board for both chords.
    expect(selected.scheme.id).toBe(state.scheme.id);
    expect(selected.scheme.roots).toEqual(state.scheme.roots);
  });

  it('deals a new map once the move lands', () => {
    const state = createChessGameState({ seed: 4 });
    const moved = play(state, 'e2', 'e4');
    expect(moved.scheme.id).not.toBe(state.scheme.id);
    // Same chords, different squares.
    expect([...moved.scheme.roots].sort()).toEqual([...state.scheme.roots].sort());
    expect([...moved.scheme.qualities].sort()).toEqual([...state.scheme.qualities].sort());
  });

  it('deals again after the opponent replies', () => {
    const afterPlayer = play(createChessGameState({ seed: 4 }), 'e2', 'e4');
    const afterOpponent = commitMove(afterPlayer, 'e7', 'e5').state;
    expect(afterOpponent.scheme.id).not.toBe(afterPlayer.scheme.id);
  });

  it('records each move under the map it was played on', () => {
    let state = createChessGameState({ seed: 4 });
    const firstMap = state.scheme;
    state = play(state, 'e2', 'e4');
    // The log has to say what was on screen, not what is on screen now.
    expect(state.history[0].chords).toEqual([
      squareToChord('e2', firstMap).symbol,
      squareToChord('e4', firstMap).symbol,
    ]);
  });

  it('can be switched off for a fixed board', () => {
    const state = createChessGameState({ shuffleEachTurn: false });
    expect(state.scheme).toEqual(DEFAULT_CHORD_SCHEME);
    expect(play(state, 'e2', 'e4').scheme).toEqual(DEFAULT_CHORD_SCHEME);
  });

  it('is reproducible from its seed', () => {
    const a = play(createChessGameState({ seed: 9 }), 'e2', 'e4');
    const b = play(createChessGameState({ seed: 9 }), 'e2', 'e4');
    expect(a.scheme).toEqual(b.scheme);
    expect(createChessGameState({ seed: 9 }).scheme).not.toEqual(createChessGameState({ seed: 10 }).scheme);
  });
});

describe('chord cursor', () => {
  const tick = (state, notes, now) => advanceCursor(state, notes, now, { settleMs: 100 });

  it('waits for the chord to settle before reading it', () => {
    let { state } = tick(createCursorState(), [60], 0);
    // Notes of one chord land milliseconds apart; each change restarts the clock.
    ({ state } = tick(state, [60, 64], 20));
    const stillSettling = tick(state, [60, 64, 67], 40);
    expect(stillSettling.event).toBe(null);

    const settled = tick(stillSettling.state, [60, 64, 67], 200);
    expect(settled.event.type).toBe('preview');
    expect(settled.event.square).toBe('c1');
  });

  it('commits on release, not on recognition', () => {
    let { state } = tick(createCursorState(), [60, 64, 67], 0);
    ({ state } = tick(state, [60, 64, 67], 200));
    const released = tick(state, [], 260);
    expect(released.event).toEqual(expect.objectContaining({ type: 'commit', square: 'c1' }));
    expect(released.state.preview).toBe(null);
  });

  it('ignores single notes and intervals', () => {
    let { state } = tick(createCursorState(), [60, 64], 0);
    ({ state } = tick(state, [60, 64], 200));
    expect(state.preview).toBe(null);
    expect(tick(state, [], 260).event).toBe(null);
  });

  it('lets the player correct the chord while still holding it', () => {
    let { state } = tick(createCursorState(), [60, 64, 67], 0);
    ({ state } = tick(state, [60, 64, 67], 200));
    expect(state.preview.square).toBe('c1');

    // Slide the third down: C major becomes C minor before release.
    ({ state } = tick(state, [60, 63, 67], 220));
    const corrected = tick(state, [60, 63, 67], 400);
    expect(corrected.event.square).toBe('c2');
    expect(tick(corrected.state, [], 460).event.square).toBe('c2');
  });
});
