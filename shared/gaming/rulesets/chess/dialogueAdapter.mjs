import { applyMove, describeGame, undoMove } from './engine.mjs';
import { fallbackCommentary } from './commentary.mjs';

export function chessCommentary(transcript, { sessionId, ply, playerSide = 'w' } = {}) {
  const game = transcript;
  if (!game || !Array.isArray(game.moves) || !game.moves.length || Number(ply) !== game.moves.length) return null;
  const status = describeGame(game);
  const previous = undoMove(game);
  const applied = previous && applyMove(previous.fen, game.moves.at(-1));
  if (!status || !applied || applied.error || applied.fen !== status.fen) return null;
  const move = applied.move;
  const event = {
    actor: move.color === playerSide ? 'player' : 'opponent', piece: move.piece,
    capture: !!move.captured, promotion: !!move.promotion, check: !!status.check,
    gameOver: !!status.game_over, outcome: status.outcome, winner: status.winner,
  };
  return {
    event, eventId: `${sessionId}:${ply}:chess-turn`,
    fallback: fallbackCommentary({ move, status, playerColor: playerSide }),
    notable: event.gameOver ? status.outcome : event.promotion ? 'promotion' : event.check ? 'check' : event.capture ? 'capture' : null,
  };
}

export default chessCommentary;
