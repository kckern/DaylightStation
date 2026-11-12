/**
 * goodFaith — one silent 0–10 score per lesson sitting, measured against what
 * the lesson asks for, and what follows from it: credit, a scale drill before
 * credit, and the presence check-in ladder. Pure arithmetic; no Node-only APIs
 * (the kiosk imports it too). The score is never shown to a child.
 */

export const GOOD_FAITH_DEFAULTS = Object.freeze({
  passScore: 6,
  maxSittings: 12,
  repsPerSet: 2,
  hands: Object.freeze(['R', 'L', 'RL']),
  checkInScaleCap: 2,
  realPlayingNotes: 8,
  borderlineLow: 5,
  borderlineHigh: 7,
  reviewPass: 0.7,
});

/**
 * Preschool mode (owner, 2026-11-12), keyed by course in
 * `videos.practice.preschool_courses`: any key press is practice
 * (practiceScore PRESCHOOL_PRACTICE), credit at 3, the presence check-in never
 * escalates past one note, and the drill before credit is one or two gentle
 * rounds ("five notes going up", "copy three notes") — never scales.
 */
export const PRESCHOOL_POLICY = Object.freeze({
  ...GOOD_FAITH_DEFAULTS,
  passScore: 3,
  checkInScaleCap: 0,
  borderlineLow: 2,
  borderlineHigh: 4,
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
    return Object.freeze({ ...base, passScore: override, borderlineLow: override - 1, borderlineHigh: override + 1 });
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

function scaleSpec({ roots, sets, reps, hands }) {
  return {
    kind: 'exercise', collection: 'scales', roots, mode: 'ionian',
    direction: 'up-then-down', span_octaves: 1, sets, reps, hands,
  };
}

/** Which check-in to ask for, from idle check-ins with no real playing between. */
export function checkInStep({ consecutiveIdle = 0 } = {}, policy = GOOD_FAITH_DEFAULTS) {
  const n = Math.max(0, Math.trunc(Number(consecutiveIdle)) || 0);
  const cap = policy.checkInScaleCap ?? 2;
  if (n === 0 || cap <= 0) return { kind: 'note' };
  return { kind: 'scales', count: Math.min(n, cap) };
}

/** The scale(s) a check-in step asks for: `count` sets of one rep, hands R then L. */
export function checkInDrill(count, { roots, rotation = 0 } = {}) {
  const sets = Math.max(1, Math.trunc(Number(count)) || 1);
  return scaleSpec({ roots: rotate(roots, rotation), sets, reps: 1, hands: ['R', 'L'].slice(0, Math.max(1, sets)) });
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

/** Unfloored score, capped at 10; a watch-only lesson (target 0) is 10. */
export function rawScore({ practiceNotes, playedSec, targetNpm }) {
  const target = Number(targetNpm) || 0;
  if (target <= 0) return 10;
  return Math.max(0, Math.min(10, (10 * practiceNpmOf({ practiceNotes, playedSec })) / target));
}

export function goodFaithScore(input) {
  return Math.floor(rawScore(input));
}

export function isBorderline(raw, policy = GOOD_FAITH_DEFAULTS) {
  return raw >= policy.borderlineLow && raw < policy.borderlineHigh;
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
 * The credit decision at (or after) the watch threshold.
 * @returns {{ credited, outcome, score, rawScore, practiceNpm, targetNpm, drill, reviewed }}
 */
export function creditDecision({
  percent, thresholdPercent, expectation, sittings, drillsPassed = 0, engaged,
  legacy, roots, rotation = 0, review = null,
} = {}, policy = GOOD_FAITH_DEFAULTS) {
  const empty = { score: null, rawScore: null, practiceNpm: null, targetNpm: expectation?.targetNpm ?? null, drill: null, reviewed: false };
  if (!(Number(percent) >= Number(thresholdPercent))) return { credited: false, outcome: 'not-watched', ...empty };
  if (!expectation) return { credited: !!engaged, outcome: 'unenforced', ...empty };
  if (legacy) return { credited: !!engaged, outcome: 'legacy', ...empty };

  const bank = bankSittings(sittings);
  const targetNpm = Number(expectation.targetNpm) || 0;
  const raw = rawScore({ ...bank, targetNpm });
  const practiceNpm = Math.round(practiceNpmOf(bank) * 10) / 10;
  let score = Math.floor(raw);
  let reviewed = false;
  let pass = score >= policy.passScore;
  let drillScore = score;
  const p = Number(review?.probability);
  if (isBorderline(raw, policy) && review && Number.isFinite(p)) {
    reviewed = true;
    pass = p >= policy.reviewPass;
    // A rejected borderline sitting owes at least the smallest drill.
    drillScore = Math.min(score, policy.passScore - 1);
  }
  const out = { score, rawScore: Math.round(raw * 100) / 100, practiceNpm, targetNpm, reviewed };
  if (pass) return { credited: true, outcome: 'credited', drill: null, ...out };
  const drill = drillForScore(drillScore, { roots, rotation }, policy);
  if (drill && (Number(drillsPassed) || 0) >= drill.reps) {
    return { credited: true, outcome: 'credited-after-drills', drill, ...out };
  }
  return { credited: false, outcome: 'drill-owed', drill, ...out };
}
