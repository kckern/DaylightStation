/**
 * Why a draw is a draw, in words a child can read off a board that still has
 * pieces on it. Short, because each one shares a line with "Draw —". One
 * table for the result card's headline and the rail's prompt, so the two never
 * disagree about the same game.
 */
export const DRAW_REASONS = Object.freeze({
  stalemate: 'stalemate',
  insufficient_material: 'not enough pieces',
  fifty_move_rule: '50-move rule',
  threefold_repetition: 'same position 3 times',
});

/** "Draw — not enough pieces", or plain "Draw" for an outcome without words. */
export function drawHeadline(outcome) {
  const reason = DRAW_REASONS[outcome];
  return reason ? `Draw — ${reason}` : 'Draw';
}
