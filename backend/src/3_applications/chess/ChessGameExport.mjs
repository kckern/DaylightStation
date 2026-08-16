import { Chess } from 'chess.js';
import { motifFor } from './ChessGameCoaching.mjs';

/**
 * Getting a reviewed game back out of this house.
 *
 * Two exports, for two different afterlives. Annotated PGN is the universal
 * format — it opens in Lichess, in any board GUI, in anything a coach already
 * uses — so a review is not trapped in one CLI's output. Drills go the other
 * way: they turn the child's own mistakes into positions to solve again, which
 * is the part of coaching that actually changes anything.
 */

/** Standard NAGs, so a GUI shows the same symbols this CLI prints. */
const NAG = Object.freeze({ inaccuracy: '$6', mistake: '$2', blunder: '$4' });

function tag(name, value) {
  return `[${name} "${String(value ?? '?').replace(/"/g, "'")}"]`;
}

/**
 * The game as annotated PGN.
 *
 * Evaluations and the engine's preference ride along as comments rather than
 * variations: a variation implies a line worth playing through, and one engine
 * move is not a line. Comments keep the mainline readable in every viewer.
 */
export function toPgn(record, review) {
  const opponent = record.opponent || {};
  const playerIsWhite = record.player_color !== 'b';
  const resultMap = { win: playerIsWhite ? '1-0' : '0-1', loss: playerIsWhite ? '0-1' : '1-0', draw: '1/2-1/2' };
  const result = resultMap[record.result] || '*';

  const headers = [
    tag('Event', 'Piano Chess'),
    tag('Site', 'DaylightStation'),
    tag('Date', String(record.played_on || '????.??.??').replace(/-/g, '.')),
    tag('Round', '-'),
    tag('White', playerIsWhite ? record.user_id : opponent.name),
    tag('Black', playerIsWhite ? opponent.name : record.user_id),
    tag('Result', result),
    tag('Termination', record.outcome),
    tag('WhiteElo', playerIsWhite ? '?' : (opponent.rung?.elo || '?')),
    tag('BlackElo', playerIsWhite ? (opponent.rung?.elo || '?') : '?'),
    tag('Annotator', 'chess-review.cli.mjs'),
  ];
  if (record.initial_fen && !record.initial_fen.startsWith('rnbqkbnr/pppppppp')) {
    headers.push(tag('FEN', record.initial_fen), tag('SetUp', '1'));
  }

  const tokens = [];
  for (const move of review.moves) {
    if (move.color === 'w') tokens.push(`${move.moveNumber}.`);
    tokens.push(move.san);
    if (NAG[move.verdict]) tokens.push(NAG[move.verdict]);
    const notes = [`${move.evalAfter}`];
    if (move.lossCp >= 75 && move.bestSan && !move.matchedBest) {
      notes.push(`better: ${move.bestSan} (-${move.lossCp}cp)`);
    }
    tokens.push(`{ ${notes.join('; ')} }`);
  }
  tokens.push(result);

  // Wrapped at 80 columns: PGN readers tolerate long lines, humans and diffs
  // do not.
  const body = [];
  let line = '';
  for (const token of tokens) {
    if (line && `${line} ${token}`.length > 80) { body.push(line); line = token; }
    else line = line ? `${line} ${token}` : token;
  }
  if (line) body.push(line);

  return `${headers.join('\n')}\n\n${body.join('\n')}\n`;
}

/**
 * The player's own mistakes, as positions to solve again.
 *
 * Only their side, and only where a clearly better move existed — a drill whose
 * answer is "your move was nearly as good" teaches nothing. The solution is the
 * engine's move at review depth, and the position is the one they actually
 * faced, so re-solving it is the same problem they got wrong.
 */
export function toDrills(record, review, { side = null, minLossCp = 150 } = {}) {
  const player = side || (record.player_color === 'b' ? 'b' : 'w');
  return review.moves
    .filter((move) => move.color === player && move.lossCp >= minLossCp && move.bestSan && !move.matchedBest)
    .map((move) => {
      const fen = review.plyFens[move.ply - 1];
      const motif = motifFor(move, fen);
      return {
        game_id: record.game_id,
        user_id: record.user_id,
        played_on: record.played_on,
        ply: move.ply,
        fen,
        // SAN is what a board UI needs to check an answer; the played move is
        // kept so a drill can say "you played this last time".
        solution: move.bestSan,
        played: move.san,
        lost_cp: move.lossCp,
        motif: motif?.motif || null,
        lesson: motif?.lesson || null,
        to_move: new Chess(fen).turn(),
      };
    });
}

export default { toPgn, toDrills };
