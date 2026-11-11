/**
 * Edge-triggered pacing beats for the middle of a race. Pure: pass the previous
 * call's `state` back in; it is never mutated. `leaderM` is the furthest LIVE rider.
 * FINAL_SECONDS repeats every call in the last 10 s (it drives the clock), the
 * rest fire once. A whole-minute SPLIT is skipped for good when another beat
 * fires in the same call.
 *
 * @param {{winCondition?: string, goalM?: number, timeCapS?: number, elapsedS?: number, leaderM?: number}} input
 * @param {object|null} prev state returned by the previous call
 * @returns {{beats: string[], state: object, secondsLeft: number|null}}
 */
export function raceBeats(input, prev) {
  const { winCondition, goalM, timeCapS, elapsedS, leaderM } = input || {};
  const fin = (v) => (Number.isFinite(v) ? v : 0);
  const goal = fin(goalM), cap = fin(timeCapS), elapsed = fin(elapsedS), leader = fin(leaderM);
  const state = { halfway: false, lastMinute: false, lastStretch: false, splitAtS: 0, ...(prev || {}) };
  const beats = [];
  const isTime = winCondition === 'time';
  const progress = isTime ? (cap > 0 ? elapsed / cap : 0) : (goal > 0 ? leader / goal : 0);
  const secondsLeft = isTime && cap > 0 ? Math.max(0, Math.round(cap - elapsed)) : null;
  const started = elapsed > 0;

  if (started && !state.halfway && progress >= 0.5) { state.halfway = true; beats.push('HALFWAY'); }
  if (started && isTime && cap >= 180 && !state.lastMinute && secondsLeft <= 60) { state.lastMinute = true; beats.push('LAST_MINUTE'); }
  if (started && !isTime && goal > 0 && !state.lastStretch && progress >= 0.9) { state.lastStretch = true; beats.push('LAST_STRETCH'); }
  if (started && secondsLeft != null && secondsLeft > 0 && secondsLeft <= 10) beats.push('FINAL_SECONDS');
  // One split a minute, skipped when a bigger beat just fired.
  const minute = Math.floor(elapsed / 60);
  if (minute >= 1 && minute * 60 > state.splitAtS && elapsed - minute * 60 < 1) {
    state.splitAtS = minute * 60;
    if (!beats.length) beats.push('SPLIT');
  }
  return { beats, state, secondsLeft };
}

export default raceBeats;
