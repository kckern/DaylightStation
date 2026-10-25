// Named cues in the show's own sound pack (media/games/party-games/jeopardy/<cue>.mp3).
export const JEOPARDY_PACK = 'jeopardy';

const ACTION_CUES = { SELECT_TILE: 'reveal', SELECT_AT: 'reveal', START_ROUND: 'board-fill', TIMEOUT: 'time-up', BUZZ: 'buzz', SET_WAGER: 'reveal', REVEAL: 'reveal', FINISH_GAME: 'win', GAME_DONE: 'win' };

export function actionCue(action) {
  if (action?.type === 'JUDGE' || action?.type === 'JUDGE_FINAL') return action.correct ? 'correct' : 'wrong';
  return ACTION_CUES[action?.type] || null;
}

export function phaseCues(phase) {
  if (phase === 'round-intro' || phase === 'round-decision') return { music: 'theme', sting: null };
  if (phase === 'final-clue') return { music: 'think', sting: null };
  if (phase === 'wager') return { music: null, sting: 'daily-double' };
  return { music: null, sting: null };
}

// One ordered authority stream feeds HTTP and websocket snapshots alike.
export function consumePresentationEvents(cursor, state, { play, gap = () => {} }) {
  const seq = state.presentationSeq;
  if (seq == null) return false;
  if (cursor.seq == null) { cursor.seq = seq; return true; }
  if (seq <= cursor.seq) return true;
  const unseen = (state.presentationEvents || []).filter(event => event.seq > cursor.seq);
  if (!unseen.length || unseen[0].seq !== cursor.seq + 1) { gap({ from: cursor.seq, to: seq }); cursor.seq = seq; return true; }
  for (const event of unseen) {
    const cue = event.reason === 'daily-double' ? 'daily-double' : actionCue(event);
    if (cue) play(cue, event);
  }
  cursor.seq = seq;
  return true;
}
