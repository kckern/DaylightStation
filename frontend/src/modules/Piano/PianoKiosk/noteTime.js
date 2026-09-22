// noteTime.js — pick the timestamp a live note is stored under.
//
// The piano-bridge payload (p20+) stamps note.on/note.off with `t`, the epoch ms
// of the Android MIDI event. Web MIDI carries event.timeStamp on the
// performance clock. Either is better than the moment the WebView got round to
// reading the message: a busy main thread adds tens to hundreds of ms, and a
// grader that judges receipt time marks on-beat playing late.
//
// A source time is trusted only when finite and within MAX_SKEW_MS of receipt.
// Outside that window the clock pairing is suspect (a stale or skewed stamp),
// and receipt time is the safer answer. See
// docs/_wip/plans/2026-09-22-timed-grading-single-judge-design.md
// ("Contract: input timestamps").

export const MAX_SKEW_MS = 1000;

/**
 * @param {number|undefined|null} eventTime  source epoch ms (may be absent)
 * @param {number} receiptMs                 Date.now() at receipt
 * @returns {{ time: number, timed: boolean, lagMs: number|null }}
 *   time  — what to store; lagMs — receipt - eventTime when timed, else null.
 */
export function resolveNoteTime(eventTime, receiptMs) {
  if (typeof eventTime === 'number' && Number.isFinite(eventTime)
      && Math.abs(receiptMs - eventTime) <= MAX_SKEW_MS) {
    return { time: eventTime, timed: true, lagMs: receiptMs - eventTime };
  }
  return { time: receiptMs, timed: false, lagMs: null };
}

/**
 * Epoch ms for a Web MIDI MIDIMessageEvent: performance.timeOrigin +
 * event.timeStamp. Returns undefined when either half is missing or the
 * timestamp is 0 (some stacks leave it unset), so the caller falls back.
 */
export function webMidiEventEpochMs(event, perf = (typeof performance !== 'undefined' ? performance : undefined)) {
  const ts = event?.timeStamp;
  const origin = perf?.timeOrigin;
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return undefined;
  if (typeof origin !== 'number' || !Number.isFinite(origin)) return undefined;
  return origin + ts;
}
