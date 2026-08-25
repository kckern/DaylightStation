import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { inverseMove, scramble } from '#shared/gaming/rulesets/rubiks-cube/index.mjs';
import { createLogger } from '#system/logging/logger.mjs';

const logger = createLogger({ source: 'backend', app: 'school', context: { component: 'rubiks-cube-course-catalog' } });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COURSE_FILE = path.join(HERE, 'course.yml');

/**
 * `course.yml` is content, not code — it is gitignored/dockerignored until an
 * author commits a real one (see the `.gitignore`/`.dockerignore` negations
 * added alongside this guard). Reading it at module scope used to mean a
 * fresh checkout or a deploy with no course authored yet took the WHOLE
 * school subsystem down at import (`schoolLifecycle.mjs` imports this
 * module statically). Same shape as `GeneratedBankSource`'s missing-recipes
 * handling: absent or invalid ⇒ logged, never thrown. The Rubik's Cube
 * course is simply unavailable — everything downstream (course id/revision
 * null, `RUBIKS_CUBE_COURSE` an empty shell, `activities()` empty) degrades
 * from there instead of crashing.
 */
function loadSource() {
  if (!fs.existsSync(COURSE_FILE)) {
    logger.warn('school.rubiks-cube.course-missing', { file: COURSE_FILE });
    return null;
  }
  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(COURSE_FILE, 'utf8'));
  } catch (err) {
    logger.error('school.rubiks-cube.course-invalid', { file: COURSE_FILE, error: err.message });
    return null;
  }
  if (parsed?.schema !== 'school.rubiks-cube-course/v1') {
    logger.error('school.rubiks-cube.course-invalid', { file: COURSE_FILE, error: 'unexpected schema', schema: parsed?.schema ?? null });
    return null;
  }
  return parsed;
}

const source = loadSource();

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
