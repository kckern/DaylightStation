/**
 * goodFaith — one silent 0–10 good-faith score per lesson sitting (the
 * session-level judgement, sittingGoodFaith.mjs) and what follows from it:
 * credit and a scale drill before credit (the presence check-in ladder lives in
 * presenceLadder.mjs). Pure; no Node-only APIs
 * (the kiosk imports it too). The score is never shown to a child.
 */
import { fallbackCredited } from './sittingGoodFaith.mjs';

export const GOOD_FAITH_DEFAULTS = Object.freeze({
  passScore: 6,
  maxSittings: 12,
  repsPerSet: 2,
  hands: Object.freeze(['R', 'L', 'RL']),
});

/**
 * Preschool mode (owner, 2026-11-12), keyed by course in
 * `videos.practice.preschool_courses`: any key press is practice
 * (practiceScore PRESCHOOL_PRACTICE), credit at 3, the presence check-in never
 * escalates past one note (presenceLadder ladderConfig preschool), and the drill before credit is one or two gentle
 * rounds ("five notes going up", "copy three notes") — never scales.
 */
export const PRESCHOOL_POLICY = Object.freeze({
  ...GOOD_FAITH_DEFAULTS,
  passScore: 3,
  drillKind: 'gentle',
  preschool: true,
});

const bare = (id) => (id == null ? '' : String(id).replace(/^plex:/, ''));

/** The policy for a course: preschool when listed, with optional pass-score overrides. */
export function policyFor({ courseId, preschoolCourses = [], passScore, preschoolPassScore } = {}) {
  const listed = (Array.isArray(preschoolCourses) ? preschoolCourses : []).map(bare);
  const pre = courseId != null && listed.includes(bare(courseId));
  const base = pre ? PRESCHOOL_POLICY : GOOD_FAITH_DEFAULTS;
  const override = Number(pre ? preschoolPassScore : passScore);
  if (Number.isFinite(override) && override >= 0 && override <= 10 && override !== base.passScore) {
    return Object.freeze({ ...base, passScore: override });
  }
  return base;
}

/** Gentle preschool rounds, in the order they are dealt. */
const ECHO_PATTERNS = [[60, 64, 62], [60, 62, 64], [64, 62, 60], [60, 67, 64]];

export const DEFAULT_DRILL_ROOTS = Object.freeze(['C', 'G', 'F']);

function rotate(list, by) {
  const arr = Array.isArray(list) && list.length ? [...list] : [...DEFAULT_DRILL_ROOTS];
  const k = ((Math.trunc(Number(by)) || 0) % arr.length + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

/** A scale exercise spec in the drill vocabulary (also used by presenceLadder). */
export function scaleSpec({ roots, sets, reps, hands }) {
  return {
    kind: 'exercise', collection: 'scales', roots, mode: 'ionian',
    direction: 'up-then-down', span_octaves: 1, sets, reps, hands,
  };
}

/** Sum practice over a lesson's sittings map/array. */
export function bankSittings(sittings) {
  const list = Array.isArray(sittings) ? sittings : Object.values(sittings || {});
  let practiceNotes = 0;
  let playedSec = 0;
  for (const s of list) {
    practiceNotes += Math.max(0, Number(s?.practiceNotes) || 0);
    playedSec += Math.max(0, Number(s?.playedSec) || 0);
  }
  return { practiceNotes, playedSec };
}

export function practiceNpmOf({ practiceNotes, playedSec }) {
  return (Number(practiceNotes) || 0) / Math.max(1, (Number(playedSec) || 0) / 60);
}

/**
 * Notes-per-minute against a target. Retired from credit (2026-11-12); kept
 * only for the practice filter's calibration record (practiceScore.calibration).
 * Unfloored, capped at 10; target 0 is 10.
 */
export function rawScore({ practiceNotes, playedSec, targetNpm }) {
  const target = Number(targetNpm) || 0;
  if (target <= 0) return 10;
  return Math.max(0, Math.min(10, (10 * practiceNpmOf({ practiceNotes, playedSec })) / target));
}

export function goodFaithScore(input) {
  return Math.floor(rawScore(input));
}

/** The drill a score owes before credit, or null at/above the pass score. */
export function drillForScore(score, { roots, rotation = 0 } = {}, policy = GOOD_FAITH_DEFAULTS) {
  const s = Math.trunc(Number(score));
  if (!Number.isFinite(s) || s >= policy.passScore) return null;
  if (policy.drillKind === 'gentle') {
    const n = s >= 1 ? 1 : 2;
    const echo = ECHO_PATTERNS[((Math.trunc(Number(rotation)) || 0) % ECHO_PATTERNS.length + ECHO_PATTERNS.length) % ECHO_PATTERNS.length];
    const rounds = [{ type: 'climb', count: 5, start: 60 }, { type: 'echo', notes: [...echo] }].slice(0, n);
    return { reps: n, sets: n, roots: [], spec: { kind: 'gentle', rounds } };
  }
  const sets = s >= 4 ? 1 : s >= 2 ? 2 : 3;
  const repsPerSet = policy.repsPerSet ?? 2;
  const dealt = rotate(roots, rotation).slice(0, sets);
  const hands = (policy.hands ?? GOOD_FAITH_DEFAULTS.hands).slice(0, sets);
  return {
    reps: sets * repsPerSet,
    sets,
    roots: dealt,
    spec: scaleSpec({ roots: dealt, sets, reps: repsPerSet, hands }),
  };
}

/**
 * The credit decision at (or after) the watch threshold (owner, 2026-11-12:
 * per-lesson expectation targets no longer decide credit). The lesson's best
 * session-level good-faith judgement decides (`sittings[*].goodFaith`, 0–10,
 * from the decision gateway); with none — model off, timed out, or never
 * asked — the lenient deterministic rule gives the benefit of the doubt:
 * meaningful playing (≥ 6 practice-like notes) or an answered presence
 * check-in credits; only nobody-there, drum-only and mash-only owe a drill.
 * @returns {{ credited, outcome, score, source: 'model'|'fallback'|null, drill }}
 */
export function creditDecision({
  percent, thresholdPercent, enforced, sittings, drillsPassed = 0, engaged,
  legacy, roots, rotation = 0,
} = {}, policy = GOOD_FAITH_DEFAULTS) {
  const empty = { score: null, source: null, drill: null };
  if (!(Number(percent) >= Number(thresholdPercent))) return { credited: false, outcome: 'not-watched', ...empty };
  if (!enforced) return { credited: !!engaged, outcome: 'unenforced', ...empty };
  if (legacy) return { credited: !!engaged, outcome: 'legacy', ...empty };

  const list = Array.isArray(sittings) ? sittings : Object.values(sittings || {});
  const judged = list.map((s) => Number(s?.goodFaith)).filter(isScore);
  let score;
  let source;
  let pass;
  if (judged.length) {
    score = Math.max(...judged);
    source = 'model';
    pass = score >= policy.passScore;
  } else {
    let practiceNotes = 0;
    let checkInsAnswered = 0;
    for (const s of list) {
      practiceNotes += Math.max(0, Number(s?.practiceNotes) || 0);
      checkInsAnswered += Math.max(0, Number(s?.checkInsAnswered) || 0);
    }
    source = 'fallback';
    pass = fallbackCredited({ practiceNotes, checkInsAnswered });
    score = pass ? null : 0;
  }
  if (pass) return { credited: true, outcome: 'credited', score, source, drill: null };
  const drill = drillForScore(Math.min(Math.floor(score), policy.passScore - 1), { roots, rotation }, policy);
  if (drill && (Number(drillsPassed) || 0) >= drill.reps) {
    return { credited: true, outcome: 'credited-after-drills', score, source, drill };
  }
  return { credited: false, outcome: 'drill-owed', score, source, drill };
}

function isScore(v) { return Number.isFinite(v) && v >= 0 && v <= 10; }
