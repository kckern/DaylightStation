export function opponentStatus({ thinking, lastMove, lastCapture, gameOver, result }) {
  if (gameOver) {
    if (result === 'win') return 'Beaten';
    if (result === 'loss') return 'Won';
    return 'Drew with you';
  }
  if (thinking) return 'Thinking…';
  if (lastCapture) return `Took your ${lastCapture}`;
  if (lastMove) return `Played ${lastMove}`;
  return 'Waiting for you';
}

export function opponentMood({ thinking, gameOver, result, tookPiece, lostPiece, givingCheck }) {
  if (gameOver) {
    if (result === 'win') return 'beaten';
    return result === 'loss' ? 'triumphant' : 'neutral';
  }
  if (thinking) return 'thinking';
  if (givingCheck) return 'attacking';
  if (tookPiece) return 'pleased';
  if (lostPiece) return 'hurt';
  return 'neutral';
}

const MOOD_LINES = Object.freeze({
  pleased: 'Thank you.',
  hurt: 'Ow.',
  attacking: 'Check!',
  triumphant: 'Good game.',
  beaten: 'You got me.',
});

export function opponentLine(mood) {
  return MOOD_LINES[mood] ?? null;
}

export default { opponentLine, opponentMood, opponentStatus };
