// frontend/src/modules/Media/shell/stateCopy.js
// Human copy for playback/device states. Raw engine states ("buffering",
// "stalled", "unknown") must never reach the UI — every surface that shows a
// state goes through here so the whole app describes playback the same way.

/** Raw engine state → short human label (Now Playing header, status lines). */
export function playbackStateLabel(state) {
  switch (state) {
    case 'playing': return 'Playing';
    case 'paused': return 'Paused';
    case 'buffering': return 'Buffering…';
    case 'stalled': return 'Having trouble streaming — hang on';
    case 'error': return 'Something went wrong';
    case 'idle':
    case 'stopped': return 'Nothing playing';
    default: return '';
  }
}

/** Fleet-card state line: what is this device doing right now?
 *  Offline devices report what they were last seen doing. */
export function deviceStateLabel(state, { offline = false } = {}) {
  if (offline) {
    if (state === 'playing') return 'Off — last seen playing';
    if (state === 'paused') return 'Off — last seen paused';
    return 'Off';
  }
  switch (state) {
    case 'playing': return 'Playing';
    case 'paused': return 'Paused';
    case 'buffering': return 'Buffering…';
    case 'stalled': return 'Having trouble streaming';
    case 'error': return 'Something went wrong';
    case 'idle':
    case 'stopped': return 'Idle';
    default: return 'Not reporting';
  }
}

/** One-line remote status ("Playing <title>", "Paused — <title>",
 *  "Nothing playing right now"). Title-less states fall back gracefully. */
export function remoteStatusLine(state, title) {
  const name = typeof title === 'string' && title.trim() ? title.trim() : '';
  if (!name) return 'Nothing playing right now';
  switch (state) {
    case 'playing': return `Playing ${name}`;
    case 'paused': return `Paused — ${name}`;
    case 'buffering': return `Buffering ${name}…`;
    case 'stalled': return `Having trouble streaming ${name}`;
    case 'idle':
    case 'stopped': return 'Nothing playing right now';
    default: return name;
  }
}

/** Queue position line ("3 of 12"). Null when there is no meaningful position
 *  to report (empty queue, single item, or no current item). */
export function queuePositionLabel(index, count) {
  if (!Number.isInteger(index) || !Number.isInteger(count)) return null;
  if (index < 0 || count < 2 || index >= count) return null;
  return `${index + 1} of ${count}`;
}

/** Playback speed chip copy ("1×", "1.25×"). Falls back to "1×" for
 *  anything unusable so the control never shows NaN. */
export function playbackRateLabel(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return '1×';
  return `${parseFloat(r.toFixed(2))}×`;
}

export default {
  playbackStateLabel,
  deviceStateLabel,
  remoteStatusLine,
  queuePositionLabel,
  playbackRateLabel,
};
