/**
 * Which Learn steps a child may start, by the household's `sheetmusic.learn.skipping`
 * policy. Pure and shared, so the kiosk's step pills and the server's validation of a
 * chosen step cannot disagree.
 *
 * - `strict`: only the passage's current step (the first one not yet ready).
 * - `open-to-silver`: any Silver-track step; Gold work waits for the passage's Silver.
 * - `open`: any step, from the start.
 *
 * A step already ready is always open: playing it again skips nothing.
 */
export const SKIP_MODES = Object.freeze(['strict', 'open-to-silver', 'open']);
export const SKIP_DEFAULT = 'open-to-silver';

const isMode = (value) => SKIP_MODES.includes(value);
const isObj = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const entries = (value) => (isObj(value)
  ? Object.fromEntries(Object.entries(value).filter(([key, mode]) => key && isMode(mode))) : {});

/** The YAML policy with every unknown mode dropped, so it falls through to the next level. */
export function normalizeSkipping(raw) {
  return {
    default: isMode(raw?.default) ? raw.default : SKIP_DEFAULT,
    learners: entries(raw?.learners),
    pieces: entries(raw?.pieces),
  };
}

/**
 * The mode for one child on one passage: the piece's entry, then (for a generated
 * ladder) the learner's, then the household default. An authored ladder keeps its
 * own order (`strict`) unless the piece's entry says otherwise.
 */
export function resolveSkipMode({ skipping, userId = null, scoreId = null, authored = false } = {}) {
  const policy = normalizeSkipping(skipping);
  if (scoreId != null && Object.hasOwn(policy.pieces, String(scoreId))) return policy.pieces[String(scoreId)];
  if (authored) return 'strict';
  if (userId != null && Object.hasOwn(policy.learners, String(userId))) return policy.learners[String(userId)];
  return policy.default;
}

/** The step the ladder would hand the child next: the first unready Silver step, then the first unready step. */
export function currentStep(segment) {
  const skills = segment?.skills ?? [];
  return skills.find((skill) => skill.track === 'silver' && !skill.ready) ?? skills.find((skill) => !skill.ready) ?? null;
}

/** `open` or `locked` for one projected step of a projected passage. */
export function stepAccess(segment, step, mode) {
  if (!step || step.ready || step.key === currentStep(segment)?.key) return 'open';
  if (mode === 'open') return 'open';
  if (mode === 'open-to-silver') return step.track === 'silver' || Boolean(segment?.certification?.silver) ? 'open' : 'locked';
  return 'locked';
}

/** Every step of a projected passage, by key. */
export function passageAccess(segment, mode) {
  return Object.fromEntries((segment?.skills ?? []).map((skill) => [skill.key, stepAccess(segment, skill, mode)]));
}
