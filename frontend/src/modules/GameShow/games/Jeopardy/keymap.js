// Host-input matrix (keyboard + GamepadAdapter synthetic keys).
// Wager/intro phases return null — they use focusable buttons instead.

const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

export function resolveJeopardyKey({ phase, revealed = false, key }) {
  if (phase === 'board') {
    if (ARROWS[key]) return { type: 'MOVE_CURSOR', dir: ARROWS[key] };
    if (key === 'Enter') return { type: 'SELECT_TILE' };
    return null;
  }
  if (phase === 'clue') {
    if (key === 'Escape' && !revealed) return { type: 'TIMEOUT' };
    if (key === 'Enter' && revealed) return { type: 'RETURN_TO_BOARD' };
    return null;
  }
  if (phase === 'judging') {
    if (key === 'ArrowUp') return { type: 'JUDGE', correct: true };
    if (key === 'ArrowDown') return { type: 'JUDGE', correct: false };
    if (key === 'Enter' && !revealed) return { type: 'REVEAL' };
    return null;
  }
  if (phase === 'final-clue' && key === 'Enter') return { type: 'REVEAL' };
  return null;
}
