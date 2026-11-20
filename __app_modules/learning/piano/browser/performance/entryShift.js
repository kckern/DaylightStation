// A WHOLE-BEAT SHIFTED ENTRY, named from the raw onsets of one cued take.
//
// Field case (2026-11-20): a beginner played bar 3 of Jingle Bells steadily and
// in order, one beat late from the first note, and was scored 0 of 4 — every
// note sat outside its own window, so the result said "timing" and nothing
// more. The notes were right; the start was wrong. This module tests the take
// against the expectation shifted by whole beats and names the shift when the
// shifted score is good, so the card can say "you started one beat late".
//
// It never grades: pass/fail and every score stay the engine's. It reads the
// attempt (target times and windows from `timedJudge`) and a raw onset log
// `{ midi, t }` on the attempt's clock, and returns plain data. Pure.

import { timedTarget, timedWindowMs } from './timedJudge.js';

/** The shifts tested, in beats. A positive shift is a late entry. */
export const ENTRY_SHIFT_BEATS = Object.freeze([-2, -1, 1, 2]);
/** The largest late shift the result waits for. */
export const ENTRY_SHIFT_MAX_LATE = 2;
/** The share of the reachable notes a shift must match to be named. */
export const ENTRY_SHIFT_SHARE = 0.75;

/** Every expected note with its target time and its event's window, in time order. */
export function expectedTimedNotes(attempt) {
  const events = attempt?.expectation?.events ?? [];
  if (!Number.isFinite(attempt?.startedAt) || !attempt?.expectation?.tempoMap?.length) return [];
  const notes = [];
  events.forEach((event, eventIndex) => {
    if (!event.notes?.length) return;
    const target = timedTarget(attempt, event);
    const windowMs = timedWindowMs(attempt, eventIndex);
    if (!Number.isFinite(target) || !Number.isFinite(windowMs)) return;
    for (const note of event.notes) notes.push({ midi: note.midi, target, windowMs, eventIndex });
  });
  return notes.sort((a, b) => a.target - b.target || a.midi - b.midi);
}

const matchesAt = (note, onset, shiftMs) => onset.midi === note.midi
  && Math.abs(onset.t - (note.target + shiftMs)) <= note.windowMs;

/**
 * Greedy match of `notes` shifted by `shiftMs` against `onsets`: each note in
 * time order takes the nearest unused onset of its own pitch inside its window.
 */
export function matchShifted(notes, onsets, shiftMs) {
  const used = new Set();
  let matched = 0;
  for (const note of notes) {
    let best = -1;
    let bestDistance = Infinity;
    onsets.forEach((onset, index) => {
      if (used.has(index) || !matchesAt(note, onset, shiftMs)) return;
      const distance = Math.abs(onset.t - (note.target + shiftMs));
      if (distance < bestDistance) { best = index; bestDistance = distance; }
    });
    if (best >= 0) { used.add(best); matched += 1; }
  }
  return matched;
}

/**
 * The notes the log could hold at a shift: those whose shifted target falls
 * inside the logged span (from arming to the result), window included. A late
 * entry's last notes can fall after the result; an early one's first notes
 * fall in the count-in, which the log covers.
 */
function reachable(notes, shiftMs, from, to) {
  return notes.filter((note) => note.target + shiftMs >= from - note.windowMs && note.target + shiftMs <= to + note.windowMs);
}

/**
 * Does shift `shiftMs` explain the take's ENTRY? The first expected note must be
 * played at its shifted target (an onset of its pitch inside its window there),
 * and no onset may match it unshifted before that onset. Without this, a piece
 * of repeated pitches (Jingle Bells: E E E | E E E) lets a steady rush or drag
 * from an on-time start line up with a whole-beat shift: the rusher's first
 * onset sits on the click, so the shift does not explain how they began.
 */
function explainsEntry(notes, onsets, shiftMs) {
  const first = notes[0];
  const entry = onsets
    .filter((onset) => matchesAt(first, onset, shiftMs))
    .sort((a, b) => Math.abs(a.t - (first.target + shiftMs)) - Math.abs(b.t - (first.target + shiftMs)))[0];
  if (!entry) return false;
  return !onsets.some((onset) => onset !== entry && onset.t < entry.t && matchesAt(first, onset, 0));
}

/**
 * Name a whole-beat shifted entry, or return null.
 *
 * A shift k is named when it matches at least ENTRY_SHIFT_SHARE of the notes
 * the log could contain at that shift (and that is at least N − |k| of the N
 * notes), the unshifted take matches less than that share, and the shift does
 * strictly better than no shift. The shift must also explain the entry
 * (`explainsEntry`). Ties between shifts go to the smaller |k|.
 *
 * @param {object} attempt the attempt snapshot (startedAt, leadInMs, expectation, policy)
 * @param {{midi:number, t:number}[]} onsets the raw onset log, attempt clock
 * @param {{beatMs:number, from:number, to:number}} span beat length and logged span
 * @returns {{beats:number, matched:number, possible:number, unshiftedShare:number}|null}
 */
export function detectEntryShift(attempt, onsets, { beatMs, from, to } = {}) {
  if (!(beatMs > 0) || !Array.isArray(onsets) || !onsets.length) return null;
  const notes = expectedTimedNotes(attempt);
  if (notes.length < 2) return null;
  const start = Number.isFinite(from) ? from : Math.min(...onsets.map((onset) => onset.t));
  const end = Number.isFinite(to) ? to : Math.max(...onsets.map((onset) => onset.t));
  const unshifted = matchShifted(notes, onsets, 0) / notes.length;
  if (unshifted >= ENTRY_SHIFT_SHARE) return null;
  let best = null;
  for (const beats of ENTRY_SHIFT_BEATS) {
    const shiftMs = beats * beatMs;
    const candidates = reachable(notes, shiftMs, start, end);
    if (candidates.length < 2 || candidates.length < notes.length - Math.abs(beats)) continue;
    if (!explainsEntry(notes, onsets, shiftMs)) continue;
    const matched = matchShifted(candidates, onsets, shiftMs);
    const share = matched / candidates.length;
    if (share < ENTRY_SHIFT_SHARE || share <= unshifted) continue;
    if (!best || share > best.share || (share === best.share && Math.abs(beats) < Math.abs(best.beats))) {
      best = { beats, matched, possible: candidates.length, share };
    }
  }
  if (!best) return null;
  return { beats: best.beats, matched: best.matched, possible: best.possible, unshiftedShare: Math.round(unshifted * 1000) / 1000 };
}

/**
 * How long a finished take should wait for a late entry's last notes.
 *
 * Only when the take's first two onsets after the count-in already look
 * shifted late (onset i matches expected note i at +k beats and not at 0) is
 * there anything to wait for. Then the result waits until the last note's
 * shifted target has passed (window included), capped at
 * ENTRY_SHIFT_MAX_LATE beats after the last target, and stops waiting as soon
 * as the log holds that note. Otherwise null: timing is unchanged.
 *
 * @returns {number|null} the time (attempt clock) to wait until, or null
 */
export function lateEntryWaitUntil(attempt, onsets, { beatMs } = {}) {
  if (!(beatMs > 0) || !Array.isArray(onsets)) return null;
  const notes = expectedTimedNotes(attempt);
  if (notes.length < 3) return null;
  const opens = notes[0].target - notes[0].windowMs;
  const playing = onsets.filter((onset) => onset.t >= opens).slice(0, 2);
  if (playing.length < 2) return null;
  // Onset i is judged against the i-th expected note (any note of its event,
  // for a chord), not against any note: on repeated pitches a late onset always
  // matches SOME note on time, which would hide the late opening.
  const owed = (index) => notes.filter((note) => note.eventIndex === notes[index].eventIndex);
  const late = [1, 2].find((beats) => playing.every((onset, index) => owed(index).some((note) => matchesAt(note, onset, beats * beatMs))
    && !owed(index).some((note) => matchesAt(note, onset, 0))));
  if (!late) return null;
  const last = notes[notes.length - 1];
  const shiftMs = late * beatMs;
  if (onsets.some((onset) => matchesAt(last, onset, shiftMs))) return null;
  return Math.min(last.target + ENTRY_SHIFT_MAX_LATE * beatMs, last.target + shiftMs + last.windowMs);
}

const BEAT_WORDS = Object.freeze({ 1: 'one beat', 2: 'two beats' });

/** The card's sentence for a named shift, in a child's terms; null for none. */
export function entryShiftSentence(beats) {
  const words = BEAT_WORDS[Math.abs(beats)];
  if (!words) return null;
  return beats > 0
    ? `You started ${words} late — start on the click after the count.`
    : `You started ${words} early — wait for the click after the count.`;
}

/** The result reason a shift is reported under. */
export const entryShiftReason = (beats) => (beats > 0 ? 'entry-late' : beats < 0 ? 'entry-early' : null);

export default { detectEntryShift, lateEntryWaitUntil, entryShiftSentence, entryShiftReason, expectedTimedNotes, matchShifted };
