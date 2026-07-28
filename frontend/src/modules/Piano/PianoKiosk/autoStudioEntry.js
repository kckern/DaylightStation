/**
 * Auto-Studio trigger detector (pure). Fires when, within the rolling
 * `windowSeconds` ending at the NEWEST note, there are at least `minNotes`
 * note-ons whose first→last span is at least `minSpanSeconds`.
 *
 * The newest entry's own startTime is the reference clock — entry times come
 * from the MIDI/bridge time base, which is NOT comparable to Date.now().
 */
export function shouldAutoEnterStudio(noteHistory, cfg) {
  const { minNotes, minSpanSeconds, windowSeconds } = cfg || {};
  if (!Array.isArray(noteHistory) || noteHistory.length < (minNotes || 1)) return false;
  const newest = noteHistory[noteHistory.length - 1]?.startTime;
  if (!Number.isFinite(newest)) return false;
  const windowStart = newest - (windowSeconds || 0) * 1000;
  let count = 0;
  let oldestInWindow = newest;
  for (let i = noteHistory.length - 1; i >= 0; i -= 1) {
    const t = noteHistory[i]?.startTime;
    if (!Number.isFinite(t) || t < windowStart) break; // history is append-ordered
    count += 1;
    oldestInWindow = t;
  }
  return count >= minNotes && (newest - oldestInWindow) >= (minSpanSeconds || 0) * 1000;
}
