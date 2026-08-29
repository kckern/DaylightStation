import { replayGame } from './engine.mjs';

export function checkersCommentary(transcript, { sessionId, ply, playerSide = 1 } = {}) {
  const game = replayGame(transcript);
  if (!game.valid || !game.moves.length || Number(ply) !== game.moves.length) return null;
  const move = game.lastMove;
  const actor = move.player === Number(playerSide) ? 'player' : 'opponent';
  // A forced continuation is one turn, not one line per jump segment.
  if (actor === 'opponent' && game.turn === move.player && game.forcedFrom !== null) return null;
  const event = {
    actor, capture: move.capture !== null, promoted: !!move.promoted,
    gameOver: !!game.status.gameOver, winner: game.status.winner, draw: !!game.status.draw,
  };
  let fallback = actor === 'player' ? 'I see your plan.' : 'Your move.';
  if (event.gameOver) fallback = event.draw ? 'That board leaves us even.'
    : event.winner === Number(playerSide) ? 'You found the finish.' : 'That was the final jump.';
  else if (event.promoted) fallback = actor === 'player' ? 'A new king changes things.' : 'Meet my newest king.';
  else if (event.capture) fallback = actor === 'player' ? 'That jump stung.' : 'I found a jump.';
  return { event, eventId: `${sessionId}:${ply}:checkers-turn`, fallback, notable: event.capture ? 'capture' : event.promoted ? 'promotion' : null };
}

export function checkersNotableFacts(record) {
  const game = replayGame({ moves: Array.isArray(record?.moves) ? record.moves : [] });
  if (!game.valid) return [];
  const captures = game.moves.filter((move) => move.capture !== null).length;
  const promotions = game.moves.filter((move) => move.promoted).length;
  return [captures ? `${captures} capture${captures === 1 ? '' : 's'}` : null,
    promotions ? `${promotions} promotion${promotions === 1 ? '' : 's'}` : null]
    .filter(Boolean);
}

export default checkersCommentary;
