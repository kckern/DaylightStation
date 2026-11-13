/**
 * sittingGoodFaith — the session-level good-faith judgement (owner, 2026-11-12:
 * "let's not trust our ratings — just evaluate engagement by non-spam,
 * good-faith detection via the Decision gateway").
 *
 * One `score` question per finished sitting, asked of the decision gateway on
 * a minimal MIDI log only (no image, no audio, no identifiers): the sitting's
 * human, practice-like notes as compact rows, notes per minute, and a few
 * plain facts — lesson length, minutes watched, the presence check-ins and how
 * they were answered, preschool mode. Mashing is set aside by the
 * deterministic filter (practiceScore) before the model sees anything.
 *
 * Pure, no Node or DOM APIs: the kiosk builds the state, the server
 * re-normalises it before it goes anywhere.
 */
import { weighEvents, PRESCHOOL_PRACTICE, PRACTICE_DEFAULTS } from './practiceScore.mjs';

/** The rubric, lowest first. Wording calibrated on the engagement audit (see the CLI). */
export const GOOD_FAITH_LEVELS = Object.freeze([
  'Nobody at the keys: no notes, or only the taps that answered the presence check-ins.',
  'Not in good faith: only noise (mashing, banging, one key hammered, random scatter) or one or two stray notes.',
  'Doubtful: only a few scattered notes; hard to tell whether anyone was trying.',
  'Good faith, sparse: someone at the keys deliberately trying what the lesson shows, even if only now and then or in a handful of short tries.',
  'Playing along: regular deliberate playing through the lesson.',
  'Locked in: playing along steadily through the whole lesson.',
]);

/** What each rung is worth on the 0–10 good-faith scale (pass: 6, preschool 3). */
export const GOOD_FAITH_LEVEL_VALUES = Object.freeze([0, 2, 4, 7, 9, 10]);

const STATE_NOTE = '`lesson` gives its length, how much was watched and how many notes were played; `presence` lists the "are you still there?" check-ins and how they were answered. `notes` is the MIDI log of what was played (pitch, onset in ms since the lesson started, duration ms, velocity), down-sampled to evenly spaced runs when long; `perMinute` counts notes per minute. Taps that only answered a check-in are not in `notes`.';

export const GOOD_FAITH_INSTRUCTIONS = `A child watched a piano video lesson at a digital piano. Did the child take part at the keyboard in good faith? Judge good faith, not skill or amount: some lessons ask for little playing. ${STATE_NOTE}`;
export const PRESCHOOL_GOOD_FAITH_INSTRUCTIONS = `A small child (3–5 years old) watched a piano video lesson at a digital piano. How much did a child really take part at the keyboard? Any deliberate key pressing by a small child counts as taking part, even if it is not musical. ${STATE_NOTE}`;

export function goodFaithQuestion(preschool = false) {
  return {
    type: 'score',
    instructions: preschool ? PRESCHOOL_GOOD_FAITH_INSTRUCTIONS : GOOD_FAITH_INSTRUCTIONS,
    levels: [...GOOD_FAITH_LEVELS],
  };
}

const round1 = (n) => Math.round(n * 10) / 10;

/** The 0–10 good-faith score from a score answer, or null when unusable. */
export function goodFaithFromAnswer(answer) {
  if (!answer || typeof answer !== 'object') return null;
  const values = GOOD_FAITH_LEVEL_VALUES;
  const p = Array.isArray(answer.probabilities) ? answer.probabilities.map(Number) : [];
  const total = p.length === values.length && p.every(Number.isFinite) ? p.reduce((a, b) => a + b, 0) : 0;
  if (total > 0) return round1(p.reduce((s, pi, i) => s + pi * values[i], 0) / total);
  const idx = Number(answer.score);
  if (!Number.isFinite(idx)) return null;
  const x = Math.max(0, Math.min(values.length - 1, idx));
  const lo = Math.floor(x);
  const hi = Math.min(values.length - 1, lo + 1);
  return round1(values[lo] + (values[hi] - values[lo]) * (x - lo));
}

export const STATE_LIMITS = Object.freeze({
  maxNotes: 200,       // raw rows the model sees
  runLength: 25,       // a long sitting is shown as evenly spaced runs of this many notes
  maxMinutes: 120,
  maxCheckIns: 60,
  stretchGapMs: 10000, // a silence this long separates two playing stretches
});

/** A lesson with no meaningful playing and no answered check-in is the only fallback drill. */
export const MEANINGFUL_NOTES = 6;

/** The lenient deterministic rule (no model, model off, or timed out): benefit of the doubt. */
export function fallbackCredited({ practiceNotes = 0, checkInsAnswered = 0 } = {}) {
  return (Number(practiceNotes) || 0) >= MEANINGFUL_NOTES || (Number(checkInsAnswered) || 0) >= 1;
}

function sampleRuns(rows, max, run) {
  if (rows.length <= max) return rows;
  const n = Math.max(1, Math.floor(max / run));
  const out = [];
  for (let k = 0; k < n; k++) {
    const s = n === 1 ? 0 : Math.floor(((rows.length - run) * k) / (n - 1));
    out.push(...rows.slice(s, s + run));
  }
  return out;
}

/**
 * Build the judge's state for one sitting.
 * @param {{ events: Array<{t,note,velocity,durMs?}>, startMs?: number, lessonSec: number,
 *   watchedSec: number, checkIns?: Array<{atMs, scales?, answered}>, preschool?: boolean }} input
 */
export function sittingGoodFaithState({ events = [], startMs = 0, lessonSec = 0, watchedSec = 0, checkIns = [], preschool = false } = {}) {
  const weighed = weighEvents(events || [], preschool ? PRESCHOOL_PRACTICE : {});
  const kept = weighed.filter((e) => e.weight >= PRACTICE_DEFAULTS.legitWeight);
  const rows = kept.map((e) => ({
    pitch: e.note,
    onsetMs: Math.max(0, Math.round(e.t - startMs)),
    durMs: Number.isFinite(e.durMs) ? Math.round(e.durMs) : null,
    velocity: e.velocity,
  }));
  const lastIdx = rows.length ? Math.floor(rows[rows.length - 1].onsetMs / 60000) : 0;
  const minutes = Math.min(STATE_LIMITS.maxMinutes, Math.max(1, Math.ceil((Number(watchedSec) || 0) / 60), lastIdx + 1));
  const perMinute = Array.from({ length: minutes }, () => 0);
  for (const r of rows) perMinute[Math.min(minutes - 1, Math.floor(r.onsetMs / 60000))] += 1;
  let stretches = 0;
  rows.forEach((r, i) => { if (i === 0 || r.onsetMs - rows[i - 1].onsetMs > STATE_LIMITS.stretchGapMs) stretches += 1; });
  const shown = sampleRuns(rows, STATE_LIMITS.maxNotes, STATE_LIMITS.runLength);
  const log = (Array.isArray(checkIns) ? checkIns : []).slice(0, STATE_LIMITS.maxCheckIns).map((c) => ({
    atMin: round1(Math.max(0, Number(c?.atMs) || 0) / 60000),
    asked: Number(c?.scales) > 0 ? 'scale' : 'note',
    answered: !!c?.answered,
  }));
  return {
    lesson: {
      lengthMin: round1((Number(lessonSec) || 0) / 60),
      watchedMin: round1((Number(watchedSec) || 0) / 60),
      preschool: !!preschool,
      notesPlayed: rows.length,
      notesShown: shown.length,
      notesSetAsideAsNoise: weighed.length - kept.length,
      distinctPitches: new Set(rows.map((r) => r.pitch)).size,
      playingStretches: stretches,
    },
    presence: { checkIns: log.length, answered: log.filter((c) => c.answered).length, log },
    perMinute,
    notes: shown,
  };
}

const num = (v, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};
const int = (v, lo = 0, hi = 1e9) => { const n = num(v, lo, hi); return n == null ? 0 : Math.round(n); };

/**
 * Server side: rebuild a state from what a kiosk sent, keeping only the known
 * fields (bounded and coerced). Returns null for anything that is not a state.
 */
export function normaliseGoodFaithState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.notes) || !raw.lesson || typeof raw.lesson !== 'object') return null;
  const l = raw.lesson;
  const notes = [];
  for (const r of raw.notes.slice(0, STATE_LIMITS.maxNotes)) {
    const pitch = num(r?.pitch, 0, 127);
    const onsetMs = num(r?.onsetMs, 0, 24 * 3600 * 1000);
    const velocity = num(r?.velocity, 0, 127);
    if (pitch == null || onsetMs == null || velocity == null) continue;
    const durMs = num(r?.durMs, 0, 600000);
    notes.push({ pitch: Math.round(pitch), onsetMs: Math.round(onsetMs), durMs: durMs == null ? null : Math.round(durMs), velocity: Math.round(velocity) });
  }
  const p = raw.presence && typeof raw.presence === 'object' ? raw.presence : {};
  const log = (Array.isArray(p.log) ? p.log : []).slice(0, STATE_LIMITS.maxCheckIns).map((c) => ({
    atMin: round1(num(c?.atMin, 0, 24 * 60) ?? 0),
    asked: c?.asked === 'scale' ? 'scale' : 'note',
    answered: c?.answered === true,
  }));
  return {
    lesson: {
      lengthMin: round1(num(l.lengthMin, 0, 24 * 60) ?? 0),
      watchedMin: round1(num(l.watchedMin, 0, 24 * 60) ?? 0),
      preschool: l.preschool === true,
      notesPlayed: int(l.notesPlayed),
      notesShown: notes.length,
      notesSetAsideAsNoise: int(l.notesSetAsideAsNoise),
      distinctPitches: int(l.distinctPitches, 0, 128),
      playingStretches: int(l.playingStretches),
    },
    presence: { checkIns: log.length, answered: log.filter((c) => c.answered).length, log },
    perMinute: (Array.isArray(raw.perMinute) ? raw.perMinute : []).slice(0, STATE_LIMITS.maxMinutes).map((v) => int(v, 0, 10000)),
    notes,
  };
}
