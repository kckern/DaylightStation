/**
 * Printed activity — a daily obligation met on paper: the program prints a
 * page from a worksheet platform (Beeloo: mazes, easy sudoku) and a grown-up's
 * scan of the page's own QR counts it. See
 * ops:docs/superpowers/specs/2026-11-13-printed-activity-program-design.md.
 *
 * Pure: no I/O, no clock, no ambient randomness. `pickActivity` takes its
 * `rng` from the caller so the audit's `domains-nondeterminism` rule holds and
 * a test can pin the pick.
 */
import { SUBJECT_IDS } from './curriculum/unitValidation.mjs';

export const PRINTED_ACTIVITY_PROGRAM_ID = 'printed-activity';

/**
 * A ceiling, for the same reason story time has one: an unmeetable daily count
 * is a config typo that leaves a child red on the board with no error anywhere.
 * Five sheets a day is already more paper than any child should owe.
 */
export const MAX_PRINTED_ACTIVITY_TARGET = 5;
const DEFAULT_TARGET = 1;
const PAPERS = ['letter', 'a4'];
const DEFAULT_PAPER = 'letter';

/** The unit id a served page is filed under: one per corpus, stable across days. */
export const servedUnitId = (corpusId) => `${PRINTED_ACTIVITY_PROGRAM_ID}:${corpusId}`;

/**
 * Validate one learner's printed-activity entry. `schedule` is validated by the
 * generic `withSchedule` wrapper and is not this validator's business; unknown
 * keys are not copied into the enrollment.
 *
 * @returns {{errors: string[], enrollment?: object}}
 */
export function validatePrintedActivityEnrollment(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['printed-activity enrollment must be a mapping'] };
  }
  const errors = [];
  if (raw.programId !== PRINTED_ACTIVITY_PROGRAM_ID) errors.push(`programId must be ${PRINTED_ACTIVITY_PROGRAM_ID}`);

  // corpusId is the instance key: SetAssignments dedupes on programId+corpusId,
  // which is what lets one learner hold a maze entry AND a sudoku entry.
  if (typeof raw.corpusId !== 'string' || !raw.corpusId.trim()) {
    errors.push('corpusId is required (e.g. beeloo:maze)');
  }

  // No default subject: a maze is arts and a sudoku is math, so guessing one
  // would file half the sheets on the wrong shelf of the board.
  if (!SUBJECT_IDS.includes(raw.subject)) {
    errors.push(`subject must be one of ${SUBJECT_IDS.join('|')}, got: ${raw.subject}`);
  }

  const target = raw.target ?? DEFAULT_TARGET;
  if (!Number.isInteger(target) || target < 1 || target > MAX_PRINTED_ACTIVITY_TARGET) {
    errors.push(`target must be an integer from 1 to ${MAX_PRINTED_ACTIVITY_TARGET}, got: ${raw.target}`);
  }

  const activity = raw.activity;
  if (activity != null && (typeof activity !== 'object' || Array.isArray(activity))) {
    errors.push('activity must be a mapping');
  }
  const a = activity && typeof activity === 'object' && !Array.isArray(activity) ? activity : {};
  if (typeof a.platform !== 'string' || !a.platform) errors.push('activity.platform is required (e.g. beeloo)');
  if (typeof a.kind !== 'string' || !a.kind) errors.push('activity.kind is required (e.g. maze)');
  if (!Number.isInteger(a.level) || a.level < 1) errors.push(`activity.level must be a positive integer, got: ${a.level}`);
  const paper = a.paper ?? DEFAULT_PAPER;
  if (!PAPERS.includes(paper)) errors.push(`activity.paper must be ${PAPERS.join('|')}, got: ${a.paper}`);

  if (errors.length) return { errors };
  return { errors: [], enrollment: {
    programId: PRINTED_ACTIVITY_PROGRAM_ID,
    corpusId: raw.corpusId.trim(),
    subject: raw.subject,
    title: raw.title === undefined || raw.title === null ? null : String(raw.title),
    target,
    activity: { platform: a.platform, kind: a.kind, level: a.level, paper },
  } };
}

/**
 * Uniform pick over `pool` minus the external ids in `exclude` — the pages this
 * child has already been given in the corpus. Null when nothing is left, which
 * the caller must surface rather than repeat a page.
 *
 * @param {{pool: {externalId: string}[], exclude: Set<string>, rng: () => number}} args
 *   `rng` returns [0, 1); required, never defaulted (domain purity).
 */
export function pickActivity({ pool, exclude, rng }) {
  if (typeof rng !== 'function') throw new TypeError('pickActivity: rng is required');
  const skip = exclude instanceof Set ? exclude : new Set();
  const left = (pool ?? []).filter((p) => p && !skip.has(p.externalId));
  if (!left.length) return null;
  return left[Math.min(left.length - 1, Math.floor(rng() * left.length))];
}

export default validatePrintedActivityEnrollment;
