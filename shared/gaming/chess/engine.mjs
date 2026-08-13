import { Chess, validateFen } from 'chess.js';
import { gamingError } from '../contracts.mjs';

/**
 * Pure chess rules, expressed the way the rest of `shared/gaming` expresses
 * everything: serializable in, serializable out, no instance held across calls.
 *
 * chess.js is a mutable class, so every function here builds a throwaway engine,
 * asks it one question, and returns plain data. That keeps the reducer replayable
 * and lets a session suspend to YAML and resume without a live object graph.
 *
 * Two layers, because they are not equally capable:
 *   - Position layer (`applyMove`, `legalMoves`, `describePosition`) works from a
 *     bare FEN. Fast, but a FEN cannot see the past, so threefold repetition is
 *     invisible to it.
 *   - Game layer (`createGame`, `playMove`, `describeGame`) carries the move list
 *     and replays it, so repetition and the fifty-move rule resolve correctly.
 */

export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const COLOR_NAMES = Object.freeze({ w: 'white', b: 'black' });

/** Accepts SAN ('Nf3') or a coordinate object ({ from, to, promotion }). */
function normalizeMove(move) {
  if (typeof move === 'string') return move.trim() || null;
  if (!move || typeof move !== 'object' || Array.isArray(move)) return null;
  const from = String(move.from || '').toLowerCase();
  const to = String(move.to || '').toLowerCase();
  if (!from || !to) return null;
  const promotion = move.promotion ? String(move.promotion).toLowerCase() : undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

function serializeMove(move) {
  return {
    color: move.color,
    from: move.from,
    to: move.to,
    piece: move.piece,
    san: move.san,
    lan: move.lan,
    flags: move.flags,
    ...(move.captured ? { captured: move.captured } : {}),
    ...(move.promotion ? { promotion: move.promotion } : {}),
    before: move.before,
    after: move.after,
  };
}

/** Builds an engine from a FEN, or null when the FEN is unusable. */
function engineFromFen(fen) {
  if (typeof fen !== 'string' || !validateFen(fen).ok) return null;
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

/** Replays a game record so history-dependent draw rules can see the whole game. */
function engineFromGame(game) {
  const engine = engineFromFen(game?.initial_fen);
  if (!engine) return null;
  for (const san of game?.moves || []) {
    try {
      engine.move(san);
    } catch {
      return null;
    }
  }
  return engine;
}

export function isValidFen(fen) {
  return typeof fen === 'string' && validateFen(fen).ok;
}

/** Legal moves as plain objects; pass `square` to scope to one origin. */
export function legalMoves(fen, { square = null } = {}) {
  const engine = engineFromFen(fen);
  if (!engine) return [];
  const options = square ? { verbose: true, square: String(square).toLowerCase() } : { verbose: true };
  let moves;
  try {
    moves = engine.moves(options);
  } catch {
    return [];
  }
  return moves.map(serializeMove);
}

/** Origin square -> destination squares, the shape a board view wants for hints. */
export function legalDestinations(fen, square = null) {
  const grouped = {};
  for (const move of legalMoves(fen, { square })) {
    (grouped[move.from] ||= []).push(move.to);
  }
  for (const from of Object.keys(grouped)) grouped[from] = [...new Set(grouped[from])].sort();
  return grouped;
}

/** True when a pawn reaching `to` from `from` must declare a promotion piece. */
export function isPromotion(fen, from, to) {
  return legalMoves(fen, { square: from }).some((move) => move.to === String(to).toLowerCase() && Boolean(move.promotion));
}

function terminalOf(engine, { repetition }) {
  if (engine.isCheckmate()) {
    const loser = engine.turn();
    return { over: true, reason: 'checkmate', winner: loser === 'w' ? 'b' : 'w' };
  }
  if (engine.isStalemate()) return { over: true, reason: 'stalemate', winner: null };
  if (engine.isInsufficientMaterial()) return { over: true, reason: 'insufficient_material', winner: null };
  if (engine.isDrawByFiftyMoves()) return { over: true, reason: 'fifty_move_rule', winner: null };
  if (repetition && engine.isThreefoldRepetition()) return { over: true, reason: 'threefold_repetition', winner: null };
  return { over: false, reason: null, winner: null };
}

function describeEngine(engine, { repetition }) {
  const terminal = terminalOf(engine, { repetition });
  const turn = engine.turn();
  return {
    fen: engine.fen(),
    turn,
    turn_name: COLOR_NAMES[turn],
    move_number: engine.moveNumber(),
    check: engine.isCheck(),
    game_over: terminal.over,
    outcome: terminal.reason,
    winner: terminal.winner,
    winner_name: terminal.winner ? COLOR_NAMES[terminal.winner] : null,
    result: terminal.over ? ({ w: '1-0', b: '0-1' }[terminal.winner] || '1/2-1/2') : null,
    // Repetition is deliberately absent from the position layer: a bare FEN has
    // no past, so claiming "not a draw" there would be a guess, not a fact.
    repetition_checked: repetition,
  };
}

/** Status of a bare position. Cannot see threefold repetition — use describeGame for that. */
export function describePosition(fen) {
  const engine = engineFromFen(fen);
  if (!engine) return null;
  return describeEngine(engine, { repetition: false });
}

/**
 * Applies one move to a FEN. Never throws; an illegal move comes back as an error.
 * Returns the resulting FEN so callers can store position-only state.
 */
export function applyMove(fen, move) {
  const engine = engineFromFen(fen);
  if (!engine) return { fen: null, move: null, error: gamingError('invalid_fen', 'Position is not a valid FEN', { fen }) };
  const normalized = normalizeMove(move);
  if (!normalized) return { fen, move: null, error: gamingError('invalid_move_input', 'Move must be SAN or { from, to }') };
  let played;
  try {
    played = engine.move(normalized);
  } catch {
    return { fen, move: null, error: gamingError('illegal_move', 'Move is not legal in this position', { move: normalized }) };
  }
  return { fen: engine.fen(), move: serializeMove(played), error: null };
}

/** A serializable game record: the seam the reducer will store. */
export function createGame({ fen = INITIAL_FEN } = {}) {
  if (!isValidFen(fen)) return null;
  return { initial_fen: fen, fen, moves: [] };
}

/** Applies one move to a game record, preserving history for repetition rules. */
export function playMove(game, move) {
  const engine = engineFromGame(game);
  if (!engine) return { game, move: null, error: gamingError('invalid_game', 'Game record could not be replayed') };
  const normalized = normalizeMove(move);
  if (!normalized) return { game, move: null, error: gamingError('invalid_move_input', 'Move must be SAN or { from, to }') };
  let played;
  try {
    played = engine.move(normalized);
  } catch {
    return { game, move: null, error: gamingError('illegal_move', 'Move is not legal in this position', { move: normalized }) };
  }
  return {
    game: { initial_fen: game.initial_fen, fen: engine.fen(), moves: [...game.moves, played.san] },
    move: serializeMove(played),
    error: null,
  };
}

/** Full status including threefold repetition, which needs the move history. */
export function describeGame(game) {
  const engine = engineFromGame(game);
  if (!engine) return null;
  return describeEngine(engine, { repetition: true });
}

/** Drops the last ply. Returns the unchanged record when there is nothing to undo. */
export function undoMove(game) {
  if (!game?.moves?.length) return game;
  const rewound = { initial_fen: game.initial_fen, fen: game.initial_fen, moves: game.moves.slice(0, -1) };
  const engine = engineFromGame(rewound);
  if (!engine) return game;
  return { ...rewound, fen: engine.fen() };
}

export function gameToPgn(game, headers = {}) {
  const engine = engineFromGame(game);
  if (!engine) return null;
  for (const [key, value] of Object.entries(headers)) engine.setHeader(key, String(value));
  return engine.pgn();
}

export function gameFromPgn(pgn) {
  try {
    const engine = new Chess();
    engine.loadPgn(pgn);
    const initial = engine.getHeaders().FEN || INITIAL_FEN;
    return { initial_fen: initial, fen: engine.fen(), moves: engine.history() };
  } catch {
    return null;
  }
}

/** Squares holding a piece of `attackedBy` that attack `square` — for threat overlays. */
export function attackersOf(fen, square, attackedBy) {
  const engine = engineFromFen(fen);
  if (!engine) return [];
  try {
    return engine.attackers(String(square).toLowerCase(), attackedBy);
  } catch {
    return [];
  }
}
