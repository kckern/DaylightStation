import { inverseMove, scramble } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';
import { RUBIKS_CUBE_COURSE_SOURCE as source } from './courseSource.mjs';

if (source?.schema !== 'school.rubiks-cube-course/v1') throw new Error('Invalid Rubik’s Cube course source');

const FOUNDATION_CHECKS = [
  { prompt: 'Which symbol means turn a face counter-clockwise?', options: ['2', 'x', "'", '+'], answer: 2 },
  { prompt: 'How many stickers are on a 3×3 cube?', options: ['27', '36', '54', '48'], answer: 2 },
  { prompt: 'What stays fixed and tells you each face colour?', options: ['Edges', 'Centres', 'Algorithms', 'Corners'], answer: 1 },
  { prompt: 'What does a 2 after a move mean?', options: ['Turn it slowly', 'Undo it', 'Use two faces', 'Turn it twice'], answer: 3 },
];

export const RUBIKS_CUBE_COURSE_ID = source.id;
export const RUBIKS_CUBE_REVISION = source.revision;

function hydrate(item) {
  const kind = item.type;
  if (kind === 'solve' || kind === 'challenge') {
    const sequence = scramble(item.seed, item.scrambleLength ?? 3);
    return { ...item, kind, solution: sequence.reverse().map(inverseMove), scrambleLength: item.scrambleLength ?? 3, goal: item.goal ?? 'solved' };
  }
  if (kind === 'quiz') return { ...item, kind, questions: [...(item.questions ?? []), ...FOUNDATION_CHECKS].slice(0, 5) };
  return { ...item, kind };
}

export const RUBIKS_CUBE_COURSE = Object.freeze({
  id: source.id, revision: source.revision, title: source.title, sourceProvenance: source.sourceProvenance,
  units: source.units.map((unit) => ({ ...unit, lessons: unit.lessons.map(hydrate) })),
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
