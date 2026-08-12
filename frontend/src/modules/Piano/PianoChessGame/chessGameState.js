import {
  DEFAULT_CHORD_SCHEME, createGame, describeGame, fenToPosition,
  legalDestinations, playMove, shuffleChordScheme, squareToChord,
} from '@shared-gaming/chess/index.mjs';

/**
 * The two-chord move flow, as a pure state machine.
 *
 * A move is two chords: the first names the piece you are lifting, the second
 * names where it lands. Every rejection carries a reason, because on a kiosk with
 * no pointer the only way a player learns why nothing happened is if the board
 * tells them.
 *
 * Kept free of React and of MIDI so the rules of the interaction can be tested
 * without a keyboard or a DOM.
 */

/** Auto-queen. Under-promotion needs a third chord, which is not worth the cost yet. */
const PROMOTION_PIECE = 'q';

/**
 * The chord map for one ply.
 *
 * Keyed on the number of moves played, so it is stable for the whole of a
 * player's turn — both chords of a move are read off the same board — and is
 * dealt again the moment a move lands. Derived rather than stored, so a state
 * restored from a saved game shows the same map it was played on.
 */
function schemeForPly(state, ply) {
  if (!state.shuffleEachTurn) return state.baseScheme;
  return shuffleChordScheme(state.baseScheme, (state.seed + ply) >>> 0);
}

export function createChessGameState({
  fen = undefined,
  playerColor = 'w',
  scheme = DEFAULT_CHORD_SCHEME,
  seed = 1,
  shuffleEachTurn = true,
} = {}) {
  const game = createGame(fen ? { fen } : {});
  const base = {
    game,
    baseScheme: scheme,
    seed: Number(seed) >>> 0,
    shuffleEachTurn,
    playerColor,
    origin: null,
    lastMove: null,
    rejection: null,
    status: describeGame(game),
    history: [],
  };
  return { ...base, scheme: schemeForPly(base, game.moves.length) };
}

export function pieceAt(fen, square) {
  return fenToPosition(fen)?.[square] ?? null;
}

/** Squares the selected piece may land on — what the board paints as available. */
export function destinationsFor(state, square) {
  return legalDestinations(state.game.fen, square)[square] || [];
}

/** True when it is the human's turn and the game is still running. */
export function isPlayerTurn(state) {
  return !state.status?.game_over && state.status?.turn === state.playerColor;
}

function reject(state, reason, square) {
  return { state: { ...state, rejection: { reason, square, at: state.history.length } }, event: { type: 'rejected', reason, square } };
}

/**
 * Feeds one recognised chord (as its square) into the flow.
 * Always returns the next state and one event; never throws.
 */
export function applySquare(state, square) {
  if (!square) return reject(state, 'unrecognised_chord', null);
  if (state.status?.game_over) return reject(state, 'game_over', square);
  if (!isPlayerTurn(state)) return reject(state, 'not_your_turn', square);

  const piece = pieceAt(state.game.fen, square);
  const isOwnPiece = piece && piece[0] === state.playerColor;

  if (!state.origin) {
    if (!piece) return reject(state, 'empty_square', square);
    if (!isOwnPiece) return reject(state, 'not_your_piece', square);
    if (!destinationsFor(state, square).length) return reject(state, 'piece_is_stuck', square);
    return {
      state: { ...state, origin: square, rejection: null },
      event: { type: 'selected', square, destinations: destinationsFor(state, square) },
    };
  }

  if (square === state.origin) {
    return { state: { ...state, origin: null, rejection: null }, event: { type: 'deselected', square } };
  }

  if (destinationsFor(state, state.origin).includes(square)) {
    return commitMove(state, state.origin, square);
  }

  // Naming another of your own pieces switches the selection rather than failing,
  // which is what a player means when they change their mind mid-move.
  if (isOwnPiece && destinationsFor(state, square).length) {
    return {
      state: { ...state, origin: square, rejection: null },
      event: { type: 'selected', square, destinations: destinationsFor(state, square) },
    };
  }
  return reject(state, 'illegal_destination', square);
}

/** Plays a legal move. Shared by the chord flow and by the opponent's reply. */
export function commitMove(state, from, to) {
  const result = playMove(state.game, { from, to, promotion: PROMOTION_PIECE });
  if (result.error) return reject(state, 'illegal_destination', to);
  const status = describeGame(result.game);
  const entry = {
    san: result.move.san,
    from,
    to,
    color: result.move.color,
    captured: result.move.captured || null,
    chords: [squareToChord(from, state.scheme)?.symbol, squareToChord(to, state.scheme)?.symbol],
  };
  const next = {
    ...state,
    game: result.game,
    origin: null,
    rejection: null,
    lastMove: { from, to },
    status,
    history: [...state.history, entry],
  };
  // The map is dealt again now the move has landed, never mid-move.
  return {
    state: { ...next, scheme: schemeForPly(next, result.game.moves.length) },
    event: { type: status.game_over ? 'game_over' : 'moved', move: result.move, status },
  };
}

/** Captured material, for the side rails. */
export function capturedPieces(history) {
  const captured = { w: [], b: [] };
  for (const entry of history) {
    if (!entry.captured) continue;
    // A capture by White removes a Black piece, so it lands on White's tally.
    captured[entry.color].push(entry.captured);
  }
  return captured;
}

export const REJECTION_MESSAGES = Object.freeze({
  unrecognised_chord: 'That chord is not on the board. Try another.',
  game_over: 'The game is over.',
  not_your_turn: 'Wait for your opponent.',
  empty_square: 'Nothing on that square.',
  not_your_piece: 'That piece belongs to your opponent.',
  piece_is_stuck: 'That piece has nowhere to go.',
  illegal_destination: 'That piece cannot reach that square.',
});
