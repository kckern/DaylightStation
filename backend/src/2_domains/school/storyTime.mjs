/**
 * Story time — a daily reading obligation with no course behind it, and the
 * only thing a parent has to decide about it is HOW MANY.
 *
 * The target lives here, on the enrollment, rather than in `school.yml`:
 * different children owe different counts, and the number is a per-learner
 * teaching decision, not a household setting.
 */
import { SUBJECT_IDS } from './curriculum/unitValidation.mjs';

export const STORY_TIME_PROGRAM_ID = 'story-time';
export const DEFAULT_STORY_TARGET = 2;

/**
 * A ceiling, on purpose. An unmeetable obligation is a config typo (`target:
 * 100` for `10`) that leaves a child permanently red on the board with no
 * error anywhere — refusing it at write time is far cheaper than diagnosing
 * a stuck tile weeks later.
 */
export const MAX_STORY_TARGET = 20;

/** Validate a story-time enrollment. Same `{errors, enrollment}` shape every other program validator returns. */
export function validateStoryTimeEnrollment(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: ['story-time enrollment must be a mapping'] };
  }
  if (raw.programId !== STORY_TIME_PROGRAM_ID) errors.push(`programId must be ${STORY_TIME_PROGRAM_ID}`);

  const target = raw.target ?? DEFAULT_STORY_TARGET;
  if (!Number.isInteger(target) || target < 1 || target > MAX_STORY_TARGET) {
    errors.push(`target must be an integer from 1 to ${MAX_STORY_TARGET}, got: ${raw.target}`);
  }

  // The subject is a shelf on the board, and the nine are fixed — an unknown
  // one would file the tile nowhere rather than under English.
  const subject = raw.subject ?? 'english';
  if (!SUBJECT_IDS.includes(subject)) {
    errors.push(`subject must be one of ${SUBJECT_IDS.join('|')}, got: ${raw.subject}`);
  }

  const title = raw.title === undefined || raw.title === null ? null : String(raw.title);
  if (errors.length) return { errors };
  // `corpusId: null` is what makes SetAssignments' dedupe key `story-time\0`
  // refuse a second story-time enrollment for the same learner — one daily
  // obligation, not two.
  return { errors: [], enrollment: { programId: STORY_TIME_PROGRAM_ID, corpusId: null, target, subject, title } };
}

export default validateStoryTimeEnrollment;
