import { validateFlashcardEnrollment } from '#domains/school/flashcards/index.mjs';
import { validateStoryTimeEnrollment, STORY_TIME_PROGRAM_ID } from '#domains/school/storyTime.mjs';
import { validateBookLogEnrollment, BOOK_LOG_PROGRAM_ID } from '#domains/school/bookLog.mjs';
import { validateSchedule } from '#domains/school/schoolCalendar.mjs';

const withSchedule = (validator) => async (raw) => {
  const result = await validator(raw);
  if (result?.errors?.length || !result?.enrollment) return result;
  const { errors, schedule } = validateSchedule(raw?.schedule);
  if (errors.length) {
    return { errors: errors.map((message) => (message.startsWith('schedule ') ? message : `schedule.${message}`)) };
  }
  // `elective: true` marks an optional program: offered on the agenda, never
  // obligating the day. Kept here so every program's validator honours it.
  if (raw?.elective !== undefined && typeof raw.elective !== 'boolean') {
    return { errors: ['elective must be true or false'] };
  }
  return {
    errors: [],
    enrollment: {
      ...result.enrollment,
      ...(schedule ? { schedule } : {}),
      ...(raw?.elective === true ? { elective: true } : {}),
    },
  };
};

/** Build the enrollment validators for the program launchers actually wired at boot. */
export function createSchoolProgramEnrollmentValidators({
  languageStudyService,
  languageReelService,
  flashcardStudyService,
  pianoCourseLauncher,
  rubiksCubeService,
  rubiksCubeCourseId,
}) {
  const validators = [
    ...(languageStudyService ? [['sentence-ladder', (raw) => languageStudyService.validateEnrollment(raw)]] : []),
    ...(languageReelService ? [['language-reels', validateLanguageReelsEnrollment]] : []),
    ...(flashcardStudyService ? [['flashcards', (raw) => validateFlashcards(raw, flashcardStudyService)]] : []),
    ...(pianoCourseLauncher ? [['piano-course', validatePianoCourseEnrollment]] : []),
    [STORY_TIME_PROGRAM_ID, validateStoryTimeEnrollment],
    // Unconditional, like story-time: the shelf needs no service to be wired
    // before a grown-up can enrol a child on it, because an enrollment with no
    // obligation is complete on its own.
    [BOOK_LOG_PROGRAM_ID, validateBookLogEnrollment],
    ...(rubiksCubeService && rubiksCubeCourseId
      ? [['rubiks-cube', (raw) => validateRubiksCubeEnrollment(raw, rubiksCubeCourseId)]]
      : []),
  ];
  return new Map(validators.map(([programId, validator]) => [programId, withSchedule(validator)]));
}

function validateLanguageReelsEnrollment(raw) {
  const valid = raw?.corpusId === 'korean-language-reels' && raw?.daily?.selection === 'random_category';
  return valid
    ? { errors: [], enrollment: { programId: 'language-reels', corpusId: raw.corpusId, daily: { selection: 'random_category' } } }
    : { errors: ['language-reels requires corpusId korean-language-reels and daily.selection random_category'] };
}

async function validateFlashcards(raw, service) {
  const result = validateFlashcardEnrollment(raw);
  if (result.errors.length) return result;
  try {
    await service.getDeck(result.enrollment.deckId);
    return result;
  } catch {
    return { errors: [`flashcard deck '${result.enrollment.deckId}' was not found`] };
  }
}

/**
 * `then` — THE COURSES THAT FOLLOW THIS ONE, named explicitly.
 *
 * A piano enrollment used to be one course and nothing after it, so the day a
 * child finished it the obligation became a debt nothing could pay: on
 * 2026-09-28 a learner finished Reading Music (53/53), moved on to the next
 * season by himself, and none of that work counted. The launcher walks
 * `[courseId, ...then]` and judges each day against the first course not
 * already finished before it (see `PianoCourseProgramLauncher#resolveCourse`).
 *
 * EXPLICIT, never inferred from season order: the learner skipped a season,
 * and a guessed successor would have assigned the wrong one.
 */
function validateCourseSequence(then, courseId) {
  if (then === undefined || then === null) return { errors: [], then: [] };
  if (!Array.isArray(then)) return { errors: ['piano-course then must be a list of course ids'] };
  if (then.some((id) => typeof id !== 'string' || !/^plex:\d+$/.test(id))) {
    return { errors: ['piano-course then entries must be of the form plex:<ratingKey>'] };
  }
  if (then.includes(courseId)) return { errors: ['piano-course then must not include the enrolled course itself'] };
  if (new Set(then).size !== then.length) return { errors: ['piano-course then must not repeat a course'] };
  return { errors: [], then: [...then] };
}

function validatePianoCourseEnrollment(raw) {
  const courseId = raw?.courseId ?? raw?.corpusId;
  if (typeof courseId !== 'string' || !/^plex:\d+$/.test(courseId)) {
    return { errors: ['piano-course requires a courseId of the form plex:<ratingKey>'] };
  }
  const subject = raw?.subject ?? 'arts';
  if (typeof subject !== 'string' || !subject) return { errors: ['piano-course subject must be a string'] };
  const sequence = validateCourseSequence(raw?.then, courseId);
  if (sequence.errors.length) return { errors: sequence.errors };
  const videosLockedAfter = raw?.videosLockedAfter;
  return { errors: [], enrollment: {
    programId: 'piano-course', corpusId: courseId, courseId, subject,
    ...(raw?.title ? { title: String(raw.title) } : {}),
    ...(Number.isInteger(videosLockedAfter) && videosLockedAfter > 0 ? { videosLockedAfter } : {}),
    ...(sequence.then.length ? { then: sequence.then } : {}),
  } };
}

function validateRubiksCubeEnrollment(raw, courseId) {
  const requested = raw?.courseId ?? raw?.corpusId;
  return requested === courseId
    ? { errors: [], enrollment: { programId: 'rubiks-cube', corpusId: requested, courseId: requested } }
    : { errors: [`rubiks-cube requires courseId ${courseId}`] };
}

export default createSchoolProgramEnrollmentValidators;
