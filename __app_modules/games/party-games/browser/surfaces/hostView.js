// Pure mapping: given the live Jeopardy snapshot, what generic command
// buttons should the mobile host see? Board tile-grid, wager steppers, and
// per-team final judging are richer and handled in the component; this covers
// the simple single-command phases so they're unit-testable.

// The open/close control for a clue's `learn` note (state machine: SHOW_LEARN).
function learnButtons(j, learn) {
  if (!learn) return [];
  return j.learning
    ? [{ label: 'Hide verse', command: { type: 'HIDE_LEARN' }, tone: 'plain' }]
    : [{ label: 'Read the verse', command: { type: 'SHOW_LEARN' }, tone: 'plain' }];
}

export function hostButtons(jeopardy) {
  const j = jeopardy;
  if (!j) return [];
  switch (j.phase) {
    case 'round-intro':
      return [{ label: j.roundIndex === 0 && !Object.values(j.used || {}).some(Boolean) ? 'Start game' : 'Start round', command: { type: 'START_ROUND' }, tone: 'primary' }];
    case 'round-decision':
      return [{ label: 'Continue to Round 2', command: { type: 'CONTINUE_ROUND' }, tone: 'primary' }, { label: 'Finish game', command: { type: 'FINISH_GAME' }, tone: 'plain' }];
    case 'answer-review':
      return j.answerReview?.judgmentPending ? [{ label: 'Correct ✓', command: { type: 'JUDGE', correct: true }, tone: 'primary' }, { label: 'Wrong ✗', command: { type: 'JUDGE', correct: false }, tone: 'danger' }] : [...learnButtons(j, j.active?.clue?.learn), { label: 'Next question', command: { type: 'RETURN_TO_BOARD' }, tone: 'primary' }];
    case 'clue':
      if (j.jeopardyFlowVersion === 2 && j.answeringTeamId) return [...(j.revealed ? [] : [{ label: 'Show answer — end attempts', command: { type: 'REVEAL' }, tone: 'plain' }]), { label: 'Correct ✓', command: { type: 'JUDGE', correct: true }, tone: 'primary' }, { label: 'Wrong ✗', command: { type: 'JUDGE', correct: false }, tone: 'danger' }];
      if (j.revealed) return [...learnButtons(j, j.active?.clue?.learn), { label: 'Back to board', command: { type: 'RETURN_TO_BOARD' }, tone: 'primary' }];
      return [
        { label: 'Show answer — end attempts', command: { type: 'REVEAL' }, tone: 'primary' },
        { label: 'Time out', command: { type: 'TIMEOUT' }, tone: 'danger' },
      ];
    case 'judging':
      return [
        ...(j.revealed ? [] : [{ label: 'Show answer — end attempts', command: { type: 'REVEAL' }, tone: 'plain' }]),
        { label: 'Correct ✓', command: { type: 'JUDGE', correct: true }, tone: 'primary' },
        { label: 'Wrong ✗', command: { type: 'JUDGE', correct: false }, tone: 'danger' },
      ];
    case 'final-category':
      return [{ label: 'Continue', command: { type: 'START_ROUND' }, tone: 'primary' }];
    case 'final-clue':
      return [{ label: 'Show answer — end attempts', command: { type: 'REVEAL' }, tone: 'primary' }];
    case 'final-judging':
      return j.skippedFinal ? [] : learnButtons(j, j.set?.final?.learn);
    default:
      return [];
  }
}
