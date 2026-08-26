/**
 * Pure learner-facing projection for the locked panel after a code resolves.
 * All I/O facts (roster, curriculum, progress, artwork availability) are
 * supplied by the application layer; this module decides only meaning.
 */
import { offeredCard } from './offeredActions.mjs';

export const CONTEXTUAL_LAUNCH_CARD_SCHEMA = 'school.self-service-card/v2';

const SUBJECT_LABELS = Object.freeze({
  english: 'English & Literature',
  writing: 'Writing & Typing',
  math: 'Math & Money',
  civilization: 'Civilization',
  scripture: 'Scripture & Gospel',
  science: 'Science & Nature',
  language: 'Language & Culture',
  skills: 'Life & Skills',
  arts: 'Arts & Culture',
});

export const schoolSubjectLabel = (id) => SUBJECT_LABELS[id] ?? id ?? 'School';

function cardStatus(resolution, actions, sentence) {
  if (actions.some((candidate) => candidate.role === 'primary')) return 'ready';
  if (resolution?.kind === 'served') return 'complete';
  if (resolution?.kind === 'locked') return 'blocked';
  if (resolution?.kind === 'empty' || resolution?.kind === 'unavailable') return 'unavailable';
  if (resolution?.kind === 'move' && resolution.state?.state === 'media_completed') return 'complete';
  return sentence ? 'waiting' : 'unavailable';
}

const crumb = (kind, id, label) => (
  id && label ? { kind, id, label } : null
);

/**
 * A Plex-hosted course wearing any number of scoping prefixes — `plex:675689`,
 * the piano launcher's doubly-prefixed `plex:plex:675689` (its `compoundId` is
 * `plex:` prepended to an enrollment id that already said `plex:`), or the
 * plan's synthetic `piano-course:plex:675689`. All three name ONE Plex rating
 * key, and the tail is the only part that identifies it.
 */
const PLEX_COURSE_TAIL = /(?:^|:)plex:(\d+)$/;

/**
 * ONE ID FOR ONE COURSE, DECIDED HERE.
 *
 * The panel finds a cover by a single rule: `plex:<ratingKey>` is asked of the
 * house's Plex image proxy, and anything else of the curriculum package the
 * course shipped in. A course id that says `plex:` twice matches neither, so it
 * fell through to the curriculum route — which has no cover for a Plex-hosted
 * course and correctly 404s — and a child stood in front of a placeholder
 * instead of Hoffman Academy.
 *
 * Canonicalising HERE, where every launch card's course id is minted, means
 * that rule stays one line on the client no matter how many prefixes the
 * program that owns a course decides to stack on it. A curriculum id is not a
 * Plex id and passes through untouched.
 */
const canonicalCourseId = (value) => {
  const id = String(value);
  const plex = PLEX_COURSE_TAIL.exec(id);
  return plex ? `plex:${plex[1]}` : id;
};

/**
 * @param {object} args
 * @param {object} args.resolution
 * @param {{id:string, displayName?:string|null}} args.learner
 * @param {string|null} args.subjectId
 * @param {{id:string,title:string}|null} [args.course]
 * @param {{id:string,title:string,position?:number|null}|null} [args.module]
 * @param {{id:string,title:string}|null} [args.lesson]
 * @param {Array<object>|null} [args.progress]
 * @param {object} [args.options]
 */
export function buildContextualLaunchCard({
  resolution,
  learner,
  subjectId = null,
  course = null,
  module = null,
  lesson = null,
  progress = null,
  options = {},
} = {}) {
  const { sentence, actions } = offeredCard(resolution, options);
  const subject = subjectId ? { id: subjectId, label: schoolSubjectLabel(subjectId) } : null;
  const normalizedLearner = learner?.id ? {
    id: learner.id,
    displayName: learner.displayName || null,
    avatar: { kind: 'learner', id: learner.id },
  } : null;
  const courseId = course?.id ? canonicalCourseId(course.id) : null;
  const normalizedCourse = courseId ? {
    id: courseId,
    title: course.title || courseId,
    artwork: { kind: 'course-poster', courseId },
  } : null;
  const normalizedModule = module?.id ? {
    id: module.id,
    title: module.title || module.id,
    ...(Number.isInteger(module.position) && module.position >= 0 ? { position: module.position } : {}),
  } : null;
  const normalizedLesson = lesson?.id ? { id: lesson.id, title: lesson.title || lesson.id } : null;
  const trail = [
    crumb('subject', subject?.id, subject?.label),
    crumb('course', normalizedCourse?.id, normalizedCourse?.title),
    crumb('module', normalizedModule?.id, normalizedModule?.title),
    crumb('lesson', normalizedLesson?.id, normalizedLesson?.title),
  ].filter(Boolean);

  return {
    schema: CONTEXTUAL_LAUNCH_CARD_SCHEMA,
    context: {
      learner: normalizedLearner,
      taxonomy: {
        subject,
        course: normalizedCourse,
        module: normalizedModule,
        lesson: normalizedLesson,
      },
      trail,
      progress: Array.isArray(progress) ? progress.map((row) => ({ ...row })) : [],
    },
    presentation: {
      status: cardStatus(resolution, actions, sentence),
      message: sentence,
    },
    actions,
  };
}

export default buildContextualLaunchCard;
