import { describe, expect, it } from 'vitest';
import { DEFAULT_CHORD_SCHEME, squareToChord } from './chordAddress.js';
import {
  applySquare, capturedPieces, clearSelection, commitMove, createChessGameState, destinationsFor, isPlayerTurn, pieceAt, playableSources,
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

  it('gives every refusal its own sequence number', () => {
    // Playing the same wrong chord twice must read as two refusals, or the
    // second one changes nothing and the board stays silent.
    const state = createChessGameState();
    const first = applySquare(state, 'e5');
    const second = applySquare(first.state, 'e5');
    expect(first.event.type).toBe('rejected');
    expect(second.state.rejection.seq).toBe(first.state.rejection.seq + 1);
    expect(second.state.rejection.square).toBe('e5');
    expect(second.event.seq).toBe(second.state.rejection.seq);
  });

  it('names every piece the player could pick up', () => {
    const state = createChessGameState();
    // Eight pawns and two knights have a legal move from the start.
    expect(playableSources(state)).toHaveLength(10);
    expect(playableSources(state)).toContain('e2');
    expect(playableSources(state)).toContain('g1');
    expect(playableSources(state)).not.toContain('e1');
    expect(playableSources(state)).not.toContain('e7');

    // Nothing is offered while the opponent is to move.
    expect(playableSources(play(state, 'e2', 'e4'))).toEqual([]);
  });

  it('puts a selected piece back down', () => {
    const selected = applySquare(createChessGameState(), 'e2').state;
    expect(selected.origin).toBe('e2');
    expect(clearSelection(selected).origin).toBe(null);
    // Cancelling with nothing selected must be harmless.
    expect(clearSelection(createChessGameState()).origin).toBe(null);
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

  it('honours an explicit underpromotion instead of always queening', () => {
    // Black king on h8, off the promotion file — with it on e8 the pawn has no
    // move at all and this test throws instead of failing. Verified: this FEN
    // offers e8=N, e8=B, e8=R+, e8=Q+.
    const state = createChessGameState({ fen: '7k/4P3/8/8/8/8/8/4K3 w - - 0 1' });
    const { state: next } = commitMove(state, 'e7', 'e8', 'n');
    expect(next.history.at(-1).san).toContain('=N');
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

  it('re-deals the same chords onto different squares', () => {
    const state = createChessGameState({ seed: 4 });
    // One full round: the player moves, the opponent answers, a new map is dealt.
    const next = commitMove(play(state, 'e2', 'e4'), 'e7', 'e5').state;
    expect(next.scheme.id).not.toBe(state.scheme.id);
    // Same chords, different squares — the vocabulary never changes.
    expect([...next.scheme.roots].sort()).toEqual([...state.scheme.roots].sort());
    expect([...next.scheme.qualities].sort()).toEqual([...state.scheme.qualities].sort());
  });

  it('holds the map through the opponent reply, then deals for the next turn', () => {
    const start = createChessGameState({ seed: 4 });
    const afterPlayer = play(start, 'e2', 'e4');
    // Still the player's map: they may already be reading the rim for next turn,
    // and a chord held across the reply must resolve against what they read.
    expect(afterPlayer.scheme.id).toBe(start.scheme.id);

    const afterOpponent = commitMove(afterPlayer, 'e7', 'e5').state;
    expect(afterOpponent.scheme.id).not.toBe(start.scheme.id);
  });

  it('deals once per round, not once per ply', () => {
    let state = createChessGameState({ seed: 4 });
    const seen = [state.scheme.id];
    for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6']]) {
      state = commitMove(state, from, to).state;
      seen.push(state.scheme.id);
    }
    // Five snapshots across two full rounds: three distinct maps, not five.
    expect(new Set(seen).size).toBe(3);
  });

  it('deals for Black on Black turns', () => {
    const start = createChessGameState({ seed: 4, playerColor: 'b' });
    // White opens: the map must not move before Black has had a turn at all.
    const afterWhite = commitMove(start, 'e2', 'e4').state;
    expect(afterWhite.scheme.id).toBe(start.scheme.id);

    // Black's own move does not end their turn — White is now thinking, and a
    // chord Black holds across that reply must resolve against the rim they read.
    const afterBlack = commitMove(afterWhite, 'e7', 'e5').state;
    expect(afterBlack.scheme.id).toBe(start.scheme.id);

    // White's reply starts Black's next turn, and only now is a new map dealt.
    const afterReply = commitMove(afterBlack, 'g1', 'f3').state;
    expect(afterReply.scheme.id).not.toBe(start.scheme.id);
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

  it('reads an octave as take-it-back, not as a chord', () => {
    // C3 + C4: one pitch class, so it can never collide with a square.
    let { state } = tick(createCursorState(), [48, 60], 0);
    const settled = tick(state, [48, 60], 200);
    expect(settled.event.type).toBe('preview');
    expect(settled.event.square).toBe(null);
    expect(settled.state.preview.escape).toBe(true);

    const released = tick(settled.state, [], 260);
    expect(released.event).toEqual({ type: 'escape' });
  });

  it('does not let a lazy release turn a played chord into a cancel', () => {
    // A doubled-root voicing (C3 E3 G3 C4) is how a child actually plays C major.
    // Lifting the inner fingers first leaves C3+C4 — an octave — held for longer
    // than the settle window. That must not overwrite the chord already read.
    let { state } = tick(createCursorState(), [48, 52, 55, 60], 0);
    ({ state } = tick(state, [48, 52, 55, 60], 200));
    expect(state.preview.square).toBe('c1');

    ({ state } = tick(state, [48, 60], 220));
    ({ state } = tick(state, [48, 60], 400));
    expect(state.preview.escape, 'the leftover octave must not arm an escape').toBeUndefined();
    expect(state.preview.square).toBe('c1');

    expect(tick(state, [], 460).event).toEqual(expect.objectContaining({ type: 'commit', square: 'c1' }));
  });

  it('still escapes when an octave is played from a clean start', () => {
    let { state } = tick(createCursorState(), [48, 60], 0);
    ({ state } = tick(state, [48, 60], 200));
    expect(state.preview.escape).toBe(true);
    expect(tick(state, [], 260).event).toEqual({ type: 'escape' });
  });

  it('says so when a chord is tapped too quickly to read', () => {
    // Pressed and released inside the settle window: previously total silence,
    // which a child cannot tell apart from a broken piano.
    let { state } = tick(createCursorState(), [60, 64, 67], 0);
    ({ state } = tick(state, [60, 64, 67], 40));
    expect(tick(state, [], 60).event).toEqual({ type: 'too_quick' });
  });

  it('stays silent for a stray single note', () => {
    // One key is not an attempt at a chord, so it earns no complaint.
    let { state } = tick(createCursorState(), [60], 0);
    ({ state } = tick(state, [60], 40));
    expect(tick(state, [], 60).event).toBe(null);
  });

  it('does not mistake a wide chord for an octave', () => {
    // C3 + E4 + G4 spans more than an octave but is still C major.
    let { state } = tick(createCursorState(), [48, 64, 67], 0);
    ({ state } = tick(state, [48, 64, 67], 200));
    expect(state.preview.escape).toBeUndefined();
    expect(state.preview.square).toBe('c1');
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
