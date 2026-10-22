// Named cues in the show's own sound pack (media/games/party-games/jeopardy/<cue>.mp3).
export const JEOPARDY_PACK = 'jeopardy';

const ACTION_CUES = { SELECT_TILE: 'reveal', SELECT_AT: 'reveal', START_ROUND: 'board-fill', TIMEOUT: 'time-up' };

export function actionCue(action) {
  if (action?.type === 'JUDGE' || action?.type === 'JUDGE_FINAL') return action.correct ? 'correct' : 'wrong';
  return ACTION_CUES[action?.type] || null;
}

export function phaseCues(phase) {
  if (phase === 'round-intro') return { music: 'theme', sting: null };
  if (phase === 'final-clue') return { music: 'think', sting: null };
  if (phase === 'wager') return { music: null, sting: 'daily-double' };
  return { music: null, sting: null };
}
