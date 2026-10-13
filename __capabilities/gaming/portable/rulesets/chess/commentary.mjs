/**
 * Deterministic, move-specific copy for the chess opponent.
 *
 * This is shared by the browser and server: a turn that reaches its visual
 * deadline must be able to speak immediately without waiting for HTTP, while a
 * server-side AI failure must say the exact same thing.
 */
const PIECES = Object.freeze({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' });

export function fallbackCommentary({ move, status, playerColor }) {
  const playerMoved = move?.color === playerColor;
  if (status?.game_over && status.outcome === 'checkmate') {
    return status.winner === playerColor ? 'You found the finish.' : 'That was the final move.';
  }
  if (status?.game_over) return 'A draw leaves us even.';
  if (status?.check) return playerMoved ? 'Now my king must answer.' : 'Your king has company.';
  if (move?.promotion) return playerMoved ? 'That pawn grew up fast.' : 'Meet my newest queen.';
  if (move?.captured) return playerMoved ? 'That capture stung.' : `I found your ${PIECES[move.captured] || 'piece'}.`;
  if (move?.piece === 'n') return 'Knights do enjoy a crooked path.';
  if (move?.piece === 'p') return playerMoved ? 'A small step with plans.' : 'My pawn marches on.';
  return playerMoved ? 'I see what you are building.' : 'Your turn to answer that.';
}

export { PIECES as COMMENTARY_PIECES };
export default { fallbackCommentary, COMMENTARY_PIECES: PIECES };
