import { validateFlashcardEnrollment } from '#domains/school/flashcards/index.mjs';
import { validateStoryTimeEnrollment, STORY_TIME_PROGRAM_ID } from '#domains/school/storyTime.mjs';
import { validateSchedule } from '#domains/school/schoolCalendar.mjs';

const withSchedule = (validator) => async (raw) => {
  const result = await validator(raw);
  if (result?.errors?.length || !result?.enrollment) return result;
  const { errors, schedule } = validateSchedule(raw?.schedule);
  if (errors.length) {
    return { errors: errors.map((message) => (message.startsWith('schedule ') ? message : `schedule.${message}`)) };
  }
  return {
    errors: [],
    enrollment: { ...result.enrollment, ...(schedule ? { schedule } : {}) },
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

function validatePianoCourseEnrollment(raw) {
  const courseId = raw?.courseId ?? raw?.corpusId;
  if (typeof courseId !== 'string' || !/^plex:\d+$/.test(courseId)) {
    return { errors: ['piano-course requires a courseId of the form plex:<ratingKey>'] };
  }
  const subject = raw?.subject ?? 'arts';
  if (typeof subject !== 'string' || !subject) return { errors: ['piano-course subject must be a string'] };
  return { errors: [], enrollment: {
    programId: 'piano-course', corpusId: courseId, courseId, subject,
    ...(raw?.title ? { title: String(raw.title) } : {}),
  } };
}

function validateRubiksCubeEnrollment(raw, courseId) {
  const requested = raw?.courseId ?? raw?.corpusId;
  return requested === courseId
    ? { errors: [], enrollment: { programId: 'rubiks-cube', corpusId: requested, courseId: requested } }
    : { errors: [`rubiks-cube requires courseId ${courseId}`] };
}

export default createSchoolProgramEnrollmentValidators;
