import { applyMove, describeGame, undoMove } from './engine.mjs';
import { fallbackCommentary } from './commentary.mjs';

export function chessCommentary(transcript, { sessionId, ply, playerSide = 'w' } = {}) {
  const game = transcript;
  if (!game || !Array.isArray(game.moves) || !game.moves.length || Number(ply) !== game.moves.length) return null;
  const status = describeGame(game);
  const previous = undoMove(game);
  const applied = previous && applyMove(previous.fen, game.moves.at(-1));
  if (!status || !applied || applied.error || applied.fen !== status.fen
    || (typeof game.fen === 'string' && game.fen !== status.fen)) return null;
  const move = applied.move;
  const event = {
    actor: move.color === playerSide ? 'player' : 'opponent', piece: move.piece,
    capture: !!move.captured, promotion: !!move.promotion, check: !!status.check,
    gameOver: !!status.game_over, outcome: status.outcome, winner: status.winner,
  };
  return {
    event, eventId: `${sessionId}:${ply}:chess-turn`,
    fallback: fallbackCommentary({ move, status, playerColor: playerSide }),
    forbiddenPatterns: [/\bO-O(?:-O)?\b/i, /\b(?:FEN|SAN|PGN)\b/i],
    notable: event.gameOver ? status.outcome : event.promotion ? 'promotion' : event.check ? 'check' : event.capture ? 'capture' : null,
  };
}

export function chessNotableFacts(record) {
  const moves = Array.isArray(record?.moves) ? record.moves.filter((move) => !move?.undone) : [];
  const captures = moves.filter((move) => move?.captured || String(move?.san || '').includes('x')).length;
  const checks = moves.filter((move) => /[+#]/.test(String(move?.san || ''))).length;
  const promotions = moves.filter((move) => String(move?.san || '').includes('=')).length;
  return [record?.outcome || null,
    captures ? `${captures} capture${captures === 1 ? '' : 's'}` : null,
    promotions ? `${promotions} promotion${promotions === 1 ? '' : 's'}` : null,
    checks ? `${checks} check${checks === 1 ? '' : 's'}` : null]
    .filter(Boolean).slice(0, 3);
}

export default chessCommentary;
