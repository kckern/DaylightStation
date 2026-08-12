import {
  createGame, describeGame, fenToPosition, legalDestinations, playMove,
} from '@shared-gaming/chess/index.mjs';
import {
  DEFAULT_CHORD_SCHEME, findChordCollisions, shuffleChordScheme, squareToChord, validateChordScheme,
} from './chordAddress.js';

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

/**
 * Default promotion piece for the chord flow: auto-queen. Under-promotion via
 * chords needs a third chord, which is not worth the cost yet — but callers that
 * already know the piece (the server engine's chosen move) can pass it through
 * commitMove's fourth argument instead of always queening.
 */
const PROMOTION_PIECE = 'q';

/**
 * The chord map for one of the player's turns.
 *
 * Keyed on the player's turn, NOT on the ply. Keying on the ply re-deals twice a
 * round: once when the player moves and again when the opponent answers. That
 * showed a map nobody could use during the opponent's think time, and — worse —
 * a player who read that rim and began holding a chord had it resolved against a
 * different map when the reply landed, committing to a square they never chose.
 *
 * A turn spans the player's move and the opponent's answer, so the map the
 * player reads is the map their chord resolves against, from first chord to
 * reply.
 *
 * Derived from the move count, which is only sound while a game is played from
 * its start. Restoring mid-game from a bare FEN loses the move list, so the deal
 * would restart from turn zero — persistence must carry `seed` and the ply count
 * with the position, not just the FEN.
 */
function playerTurnOf(ply, playerColor) {
  // White moves on even plies, so a White turn spans [2n, 2n+1]. Black moves on
  // odd plies, so a Black turn spans [2n+1, 2n+2] — and ply 0, where Black is
  // still waiting for the opening move, has to share the map of the turn it
  // leads into, or the rim would change under them before they ever played.
  if (playerColor === 'w') return Math.floor(ply / 2);
  return Math.max(0, Math.floor((ply - 1) / 2));
}

function schemeForPly(state, ply) {
  if (!state.shuffleEachTurn) return state.baseScheme;
  return shuffleChordScheme(state.baseScheme, (state.seed + playerTurnOf(ply, state.playerColor)) >>> 0);
}

export function createChessGameState({
  fen = undefined,
  playerColor = 'w',
  scheme = DEFAULT_CHORD_SCHEME,
  seed = 1,
  shuffleEachTurn = true,
} = {}) {
  const game = createGame(fen ? { fen } : {});
  // A colliding scheme is not a crash, it is a board where two squares sound
  // identical — so it has to be refused at the door rather than discovered by a
  // player whose chord keeps landing on the wrong piece.
  const check = validateChordScheme(scheme);
  const collisions = check.valid ? findChordCollisions(scheme) : [];
  const safeScheme = check.valid && collisions.length === 0 ? scheme : DEFAULT_CHORD_SCHEME;
  const schemeRejected = safeScheme !== scheme
    ? { errors: check.errors, collisions: collisions.map((c) => c.members.map((m) => m.square)) }
    : null;

  const base = {
    game,
    baseScheme: safeScheme,
    schemeRejected,
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

/**
 * Every piece the player could pick up right now.
 *
 * Shown before a selection so the commonest refusal — naming a square that holds
 * nothing, or an opponent's piece — is prevented rather than punished.
 */
export function playableSources(state) {
  if (!isPlayerTurn(state)) return [];
  return Object.keys(legalDestinations(state.game.fen)).sort();
}

/** True when it is the human's turn and the game is still running. */
export function isPlayerTurn(state) {
  return !state.status?.game_over && state.status?.turn === state.playerColor;
}

/**
 * Refusals carry a sequence number.
 *
 * Playing the same wrong chord twice is two separate refusals, and the board has
 * to be able to tell them apart — otherwise the second one changes no state, so
 * nothing re-renders and the player gets silence exactly when they most need
 * telling. The counter is what re-fires the flash.
 */
function reject(state, reason, square) {
  const rejection = { reason, square, seq: (state.rejection?.seq ?? 0) + 1, at: state.history.length };
  return { state: { ...state, rejection }, event: { type: 'rejected', reason, square, seq: rejection.seq } };
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

/** Puts the piece back down. Safe to call with nothing selected. */
export function clearSelection(state) {
  return { ...state, origin: null, rejection: null };
}

/** Plays a legal move. Shared by the chord flow and by the opponent's reply. */
export function commitMove(state, from, to, promotion = PROMOTION_PIECE) {
  const result = playMove(state.game, { from, to, promotion });
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
