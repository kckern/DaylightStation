/**
 * Tuning agent inputs and brakes (mastery redesign §7). Pure: the digest is
 * the model's only view of a learner's package, computed from status v3 and
 * the per-day files; `applyTuningProposal` is the only way a proposal becomes
 * a value, and it enforces every brake — one step, one change per setting per
 * dwell window, clamped to bounds, tunables only. Nothing reads a clock.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { STATES } from './mastery.mjs';

export const TUNABLE = Object.freeze({
  'round.size': Object.freeze({ step: 1 }),
  'drill.afterMisses': Object.freeze({ step: 1 }),
  'batch.newPerDay': Object.freeze({ step: 1 }),
  'batch.workingSet': Object.freeze({ step: 1 }),
  'review.gapScale': Object.freeze({ step: 0.1 }),
  'review.typedEvery': Object.freeze({ step: 1 }),
});

/** Spec §7 bounds; the household School config may narrow them. */
export const TUNING_BOUNDS = Object.freeze({
  'round.size': Object.freeze([3, 7]),
  'drill.afterMisses': Object.freeze([1, 3]),
  'batch.newPerDay': Object.freeze([2, 6]),
  'batch.workingSet': Object.freeze([4, 10]),
  'review.gapScale': Object.freeze([0.5, 1.5]),
  'review.typedEvery': Object.freeze([1, 4]),
});

/** Grown-up only: never tuned. */
export const GROWN_UP_SETTINGS = Object.freeze(['session.capMinutes', 'drill.perSitting', 'round.maxPasses', 'typing.passScore']);

const TUNABLE_KEYS = Object.keys(TUNABLE);
const TRAILING = 7;
const PILE_KEYS = ['familiar', 'claimed', 'other'];
// gapScale moves in tenths; integers are unaffected.
const tidy = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

function readPath(settings, dotted) {
  const [group, key] = dotted.split('.');
  return settings?.[group]?.[key];
}

/** Resolved (nested) settings → flat `{ 'round.size': 5, … }` over the tunables. */
export function tunableValues(settings) {
  return Object.fromEntries(TUNABLE_KEYS.map((key) => [key, readPath(settings, key)]));
}

/**
 * Resolved (nested) settings with a learner's tuned values laid over them —
 * tunables only, finite numbers only, clamped to the spec bounds and to the
 * household's `word_ladder.bounds` (the narrower of the two). Pure.
 */
export function withTunedValues(settings, values = {}, bounds = null) {
  const out = structuredClone(settings);
  for (const [dotted, value] of Object.entries(values ?? {})) {
    if (!Object.hasOwn(TUNABLE, dotted) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    const [group, key] = dotted.split('.');
    if (typeof out?.[group]?.[key] !== 'number') continue;
    let [lo, hi] = TUNING_BOUNDS[dotted];
    const household = bounds?.[dotted];
    if (Array.isArray(household) && household.length === 2 && household.every(Number.isFinite)) {
      lo = Math.max(lo, household[0]); hi = Math.min(hi, household[1]);
    }
    out[group][key] = tidy(Math.min(hi, Math.max(lo, value)));
  }
  return out;
}

// ---- tuning.yml -----------------------------------------------------------

export const TUNING_FILE_SCHEMA = 'school.word-ladder-tuning/v1';
export const TUNING_HISTORY_KEEP = 60;

/** A learner × package's tuning record (`tuning.yml`, spec §7). */
export function emptyTuning() {
  return { schema: TUNING_FILE_SCHEMA, values: {}, lastChanged: {}, lastTunedDay: null, history: [] };
}

// ---- Digest ---------------------------------------------------------------

function pileOf(round, wordId) {
  const pile = round.stream?.latest?.[wordId];
  return pile === 'familiar' || pile === 'claimed' ? pile : 'other';
}

function capMinutesOf(dayFile, settings) {
  return dayFile.atOpen?.settings?.session?.capMinutes ?? settings?.session?.capMinutes ?? 15;
}

/**
 * A typed answer's score as it now stands: a grown-up re-grade
 * (`items[id].regraded = { at, actorId, pass }`) overrides the judge the way
 * the re-grade rewrote the judge cache — pass → passScore, fail → 1.
 */
function typedScoreOf(item, dayFile, settings) {
  if (typeof item?.regraded?.pass === 'boolean') {
    if (!item.regraded.pass) return 1;
    return settings?.typing?.passScore ?? dayFile.atOpen?.settings?.typing?.passScore ?? 6;
  }
  return item?.result?.score;
}

/** One day file's numbers. `stalls` is not recorded in the day file, so it is null. */
export function dayStats(dayFile, settings) {
  const passedByPile = { familiar: 0, claimed: 0, other: 0 };
  const failedByPile = { familiar: 0, claimed: 0, other: 0 };
  let quizzed = 0;
  let passed = 0;
  for (const round of dayFile.rounds ?? []) {
    for (const id of round.quiz?.passed ?? []) { passedByPile[pileOf(round, id)] += 1; passed += 1; quizzed += 1; }
    for (const id of round.quiz?.failed ?? []) { failedByPile[pileOf(round, id)] += 1; quizzed += 1; }
  }
  const answered = Object.values(dayFile.rechecks?.answered ?? {});
  const items = Object.entries(dayFile.items ?? {});
  const typedScores = items.map(([, item]) => typedScoreOf(item, dayFile, settings)).filter((score) => typeof score === 'number');
  const activeMs = dayFile.activeMs ?? 0;
  const capHit = activeMs >= capMinutesOf(dayFile, settings) * 60000;
  const credited = Boolean(dayFile.doneAt);
  const goalSitting = Object.values(dayFile.sittings ?? {}).some((row) => row?.reason === 'goal');
  return {
    quizzed,
    passed,
    passedByPile,
    failedByPile,
    rechecks: { asked: answered.length, missed: answered.filter((row) => row?.correct !== true).length },
    dontKnow: items.filter(([, item]) => item?.response?.dontKnow === true).length,
    typedScores,
    judgeFallbacks: items.filter(([, item]) => item?.result?.judge === 'fallback').length,
    stalls: null,
    activeMin: Math.round(activeMs / 6000) / 10,
    capHit,
    credited,
    newIntroduced: items.filter(([id]) => id.includes(':i:') && id.endsWith(':flash')).length,
    drillsRun: (dayFile.drills ?? []).length,
    // Done with the cap still unspent is a goal; at the cap it is a goal only
    // when a sitting closed on it.
    reachedGoal: credited && (goalSitting || !capHit),
  };
}

const mean = (values) => (values.length ? round2(values.reduce((a, b) => a + b, 0) / values.length) : null);
const rate = (flags) => mean(flags.map((flag) => (flag ? 1 : 0)));

function trailingAverage(stats) {
  if (!stats.length) return { days: 0 };
  const avg = (pick) => mean(stats.map(pick));
  const scores = stats.flatMap((s) => s.typedScores);
  return {
    days: stats.length,
    quizzed: avg((s) => s.quizzed),
    passed: avg((s) => s.passed),
    passedByPile: Object.fromEntries(PILE_KEYS.map((key) => [key, avg((s) => s.passedByPile[key])])),
    failedByPile: Object.fromEntries(PILE_KEYS.map((key) => [key, avg((s) => s.failedByPile[key])])),
    rechecks: { asked: avg((s) => s.rechecks.asked), missed: avg((s) => s.rechecks.missed) },
    dontKnow: avg((s) => s.dontKnow),
    typedScoreMean: mean(scores),
    judgeFallbacks: avg((s) => s.judgeFallbacks),
    stalls: null,
    activeMin: avg((s) => s.activeMin),
    capHit: rate(stats.map((s) => s.capHit)),
    newIntroduced: avg((s) => s.newIntroduced),
    drillsRun: avg((s) => s.drillsRun),
    reachedGoal: rate(stats.map((s) => s.reachedGoal)),
    creditedZeroQuizzed: stats.filter((s) => s.credited && s.quizzed === 0).length,
  };
}

function wordSummary(status) {
  const words = Object.values(status?.words ?? {});
  const byState = Object.fromEntries(STATES.map((state) => [state, 0]));
  for (const word of words) if (word?.state in byState) byState[word.state] += 1;
  return {
    total: words.length,
    byState,
    tricky: words.filter((word) => word?.tricky === true).length,
    excluded: words.filter((word) => word?.excluded === true).length,
  };
}

/**
 * The tuner's input. `days` are the last study days' files, oldest first; the
 * last one is the day just ended, the (up to) 7 before it the trailing window.
 */
export function buildTuningDigest({ status, days = [], settings, lastChanged = {} }) {
  const today = days.at(-1) ?? null;
  const trailing = days.slice(0, -1).slice(-TRAILING);
  return {
    day: today?.day ?? null,
    settings: tunableValues(settings),
    lastChanged: Object.fromEntries(Object.keys(lastChanged ?? {}).sort().map((key) => [key, lastChanged[key]])),
    words: wordSummary(status),
    today: today ? dayStats(today, settings) : null,
    trailing7: trailingAverage(trailing.map((dayFile) => dayStats(dayFile, settings))),
  };
}

// ---- Brakes ---------------------------------------------------------------

// Study days since the last change: days in `studyDays` after it, up to today.
function studyDaysSince(last, day, studyDays) {
  return studyDays.filter((d) => d > last && d <= day).length;
}

/**
 * Applies a tuner proposal (`[{setting, to, reason}]` or `{changes: […]}`)
 * to flat current values. `studyDays` (oldest first) is required: dwell counts
 * study days, never calendar days. Every change that violates a brake is dropped with
 * its brake name; the rest are applied and stamped in `lastChanged`.
 */
export function applyTuningProposal({ current, proposal, bounds = TUNING_BOUNDS, day, lastChanged = {}, dwellDays = 5, studyDays }) {
  if (!Array.isArray(studyDays)) throw new ValidationError('studyDays is required (dwell counts study days)');
  const changes = Array.isArray(proposal) ? proposal : (proposal?.changes ?? []);
  const next = { ...current };
  const stamps = { ...lastChanged };
  const applied = [];
  const dropped = [];
  const touched = new Set();
  for (const change of changes) {
    const { setting, to, reason = '' } = change ?? {};
    const drop = (brake) => dropped.push({ setting, to, reason, brake });
    if (GROWN_UP_SETTINGS.includes(setting)) { drop('not-tunable'); continue; }
    if (!Object.hasOwn(TUNABLE, setting)) { drop('unknown'); continue; }
    const last = stamps[setting];
    if (touched.has(setting) || (typeof last === 'string' && studyDaysSince(last, day, studyDays) < dwellDays)) { drop('dwell'); continue; }
    const from = next[setting];
    if (typeof to !== 'number' || !Number.isFinite(to) || typeof from !== 'number') { drop('step'); continue; }
    const [specLo, specHi] = TUNING_BOUNDS[setting];
    const household = bounds?.[setting];
    const lo = Array.isArray(household) && Number.isFinite(household[0]) ? Math.max(specLo, household[0]) : specLo;
    const hi = Array.isArray(household) && Number.isFinite(household[1]) ? Math.min(specHi, household[1]) : specHi;
    const clamped = tidy(Math.min(hi, Math.max(lo, to)));
    if (clamped !== tidy(to) && clamped === tidy(from)) { drop('bounds'); continue; }
    if (tidy(Math.abs(clamped - from)) !== TUNABLE[setting].step) { drop('step'); continue; }
    next[setting] = clamped;
    stamps[setting] = day;
    touched.add(setting);
    applied.push({ setting, from, to: clamped, reason, ...(clamped !== tidy(to) ? { clampedFrom: to } : {}) });
  }
  return { next, applied, dropped, lastChanged: stamps };
}
