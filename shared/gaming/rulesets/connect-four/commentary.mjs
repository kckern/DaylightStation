import { replayGame } from './engine.mjs';

export function connectFourCommentary(transcript, { sessionId, ply, playerSide = 1 } = {}) {
  const game = replayGame(transcript);
  if (!game.valid || !game.moves.length || Number(ply) !== game.moves.length) return null;
  const lastPlayer = game.moves.length % 2 === 1 ? 1 : 2;
  const actor = lastPlayer === Number(playerSide) ? 'player' : 'opponent';
  const status = game.status;
  const event = { actor, gameOver: status.gameOver, winner: status.winner, draw: status.draw };
  let fallback = actor === 'player' ? 'I see where that is going.' : 'The board is yours.';
  if (status.gameOver) fallback = status.draw ? 'Not one space left between us.'
    : status.winner === Number(playerSide) ? 'You connected the line.' : 'Four in a row.';
  return { event, eventId: `${sessionId}:${ply}:connect-four-turn`, fallback, notable: status.gameOver ? 'four-in-a-row' : null };
}

export default connectFourCommentary;
