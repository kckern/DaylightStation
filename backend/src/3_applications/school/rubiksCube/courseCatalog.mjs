import { inverseMove, scramble } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';
import { RUBIKS_CUBE_COURSE_SOURCE as source } from './courseSource.mjs';
import { createLogger } from '#system/logging/logger.mjs';

const logger = createLogger({ source: 'backend', app: 'school', context: { component: 'rubiks-cube-course-catalog' } });

// The course content now lives in a committed JS module (main, 2026-08-25),
// which is the right fix: it was previously read from `course.yml` at module
// scope, and that file matched `.gitignore`/`.dockerignore`, so it could never
// reach the image — taking the WHOLE school subsystem down at import, because
// `schoolLifecycle.mjs` imports this module statically.
//
// The schema check stays, but it must NEVER throw. A malformed source should
// make the Rubik's Cube course unavailable, not kill school. Same shape as
// `GeneratedBankSource`'s missing-recipes handling: absent or invalid ⇒
// logged, never thrown. Everything downstream (null course id/revision, empty
// activities) degrades from there.
if (source?.schema !== 'school.rubiks-cube-course/v1') {
  logger.error('school.rubiks-cube.course-invalid', { schema: source?.schema ?? null });
}

const FOUNDATION_CHECKS = [
  { prompt: 'Which symbol means turn a face counter-clockwise?', options: ['2', 'x', "'", '+'], answer: 2 },
  { prompt: 'How many stickers are on a 3×3 cube?', options: ['27', '36', '54', '48'], answer: 2 },
  { prompt: 'What stays fixed and tells you each face colour?', options: ['Edges', 'Centres', 'Algorithms', 'Corners'], answer: 1 },
  { prompt: 'What does a 2 after a move mean?', options: ['Turn it slowly', 'Undo it', 'Use two faces', 'Turn it twice'], answer: 3 },
];

export const RUBIKS_CUBE_COURSE_ID = source?.id ?? null;
export const RUBIKS_CUBE_REVISION = source?.revision ?? null;

function hydrate(item) {
  const kind = item.type;
  if (kind === 'solve' || kind === 'challenge') {
    const sequence = scramble(item.seed, item.scrambleLength ?? 3);
    return { ...item, kind, solution: sequence.reverse().map(inverseMove), scrambleLength: item.scrambleLength ?? 3, goal: item.goal ?? 'solved' };
  }
  if (kind === 'quiz') return { ...item, kind, questions: [...(item.questions ?? []), ...FOUNDATION_CHECKS].slice(0, 5) };
  return { ...item, kind };
}

// An absent/invalid source degrades to an empty-but-well-shaped course: no
// units, no lessons — never `null`, so every consumer that reads
// `.units`/`.title` off `RUBIKS_CUBE_COURSE` (RubiksCubeCourseService's
// projections in particular) gets an empty course instead of a TypeError.
export const RUBIKS_CUBE_COURSE = Object.freeze({
  id: source?.id ?? null, revision: source?.revision ?? null, title: source?.title ?? null, sourceProvenance: source?.sourceProvenance ?? null,
  units: source ? source.units.map((unit) => ({ ...unit, lessons: unit.lessons.map(hydrate) })) : [],
});

export function activities(course = RUBIKS_CUBE_COURSE) {
  return course.units.flatMap((unit, unitIndex) => unit.lessons.map((lesson, lessonIndex) => ({ ...lesson, unitId: unit.id, unitTitle: unit.title, unitIndex, lessonIndex })));
}

export function activityById(id) { return activities().find((lesson) => lesson.id === id) ?? null; }

export function publicActivity(activity) {
  if (!activity) return null;
  const { solution, questions, ...safe } = activity;
  return { ...safe, ...(questions ? { questions: questions.map(({ answer, ...question }) => question) } : {}) };
}
