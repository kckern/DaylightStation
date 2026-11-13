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
import { validateEntryIcon } from "./entryIcon.mjs";

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

const trimmedOrNull = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** The unit id a served page is filed under: one per corpus, stable across days. */
export const servedUnitId = (corpusId) => `${PRINTED_ACTIVITY_PROGRAM_ID}:${corpusId}`;

/**
 * The household-facing name of an entry: its own `title`, else its capitalised
 * kind ("Maze"), else a generic label. One helper so the agenda row, the
 * ticket's "is printing" message and the served row all say the same thing.
 */
export function printedActivityLabel(entry) {
  const title = trimmedOrNull(entry?.title);
  if (title) return title;
  const kind = trimmedOrNull(entry?.activity?.kind);
  return kind ? kind[0].toUpperCase() + kind.slice(1) : 'Printed activity';
}

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
  const platform = trimmedOrNull(a.platform);
  const kind = trimmedOrNull(a.kind);
  if (!platform) errors.push('activity.platform is required (e.g. beeloo)');
  if (!kind) errors.push('activity.kind is required (e.g. maze)');
  if (!Number.isInteger(a.level) || a.level < 1) errors.push(`activity.level must be a positive integer, got: ${a.level}`);
  const paper = a.paper ?? DEFAULT_PAPER;
  if (!PAPERS.includes(paper)) errors.push(`activity.paper must be ${PAPERS.join('|')}, got: ${a.paper}`);

  // An optional disc icon (a name in the School icon registry); no default
  // here, so a sheet falls back to its shelf's icon on the board.
  // `printOnCardTap: true` makes the learner's card print this sheet instead
  // of the agenda while it is owed today (for a child who cannot read one).
  if (raw.printOnCardTap != null && typeof raw.printOnCardTap !== 'boolean') {
    errors.push(`printOnCardTap must be true or false, got: ${raw.printOnCardTap}`);
  }

  const iconCheck = validateEntryIcon(raw.icon);
  errors.push(...iconCheck.errors);

  if (errors.length) return { errors };
  // `cadence` is not copied: printed-activity is daily only (`target` sheets
  // per study day), so the plan entry is always `cadence: daily`.
  return { errors: [], enrollment: {
    programId: PRINTED_ACTIVITY_PROGRAM_ID,
    corpusId: raw.corpusId.trim(),
    subject: raw.subject,
    // Only a real string is a title: `{}` must not become "[object Object]" on the board.
    title: trimmedOrNull(raw.title),
    target,
    activity: { platform, kind, level: a.level, paper },
    ...(iconCheck.icon ? { icon: iconCheck.icon } : {}),
    ...(raw.printOnCardTap === true ? { printOnCardTap: true } : {}),
  } };
}

/**
 * Uniform pick over `pool` minus the external ids in `exclude` — every page on
 * the platform already given to anyone in the household (voided reservations
 * aside). Null when nothing is left, which
 * the caller must surface rather than repeat a page.
 *
 * @param {{pool: {externalId: string}[], exclude: Iterable<string>, rng: () => number}} args
 *   `exclude` is any iterable of external ids; `rng` returns [0, 1) and is
 *   required, never defaulted (domain purity).
 */
export function pickActivity({ pool, exclude, rng }) {
  if (typeof rng !== 'function') throw new TypeError('pickActivity: rng is required');
  // Any iterable of ids, but never "nothing": treating a bad exclude as empty
  // would hand a child a page they have already had.
  if (exclude == null || typeof exclude[Symbol.iterator] !== 'function' || typeof exclude === 'string') {
    throw new TypeError('pickActivity: exclude must be an iterable of external ids');
  }
  const skip = new Set(exclude);
  const left = (pool ?? []).filter((p) => p && !skip.has(p.externalId));
  if (!left.length) return null;
  const at = Math.floor(rng() * left.length);
  return left[Math.min(left.length - 1, Math.max(0, Number.isFinite(at) ? at : 0))];
}
