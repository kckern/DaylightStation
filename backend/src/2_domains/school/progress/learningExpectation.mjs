/**
 * The authored-expectation contract shared by every `ILearningExpectationSource`
 * (configured pacing dates, the curriculum-derived outline, and whatever comes
 * next). Lives in its own file — rather than inside `instructionalInsights.mjs`
 * or `learningProgress.mjs` — because BOTH of those domain modules need to
 * validate expectations (pacing review and, since Task 11, `curriculumHistory`
 * outline annotation) and neither may import from the other without a cycle.
 */

export const LEARNING_EXPECTATION_SCHEMA = 'school.learning-expectation/v1';

export const EXPECTATION_TARGET_FIELD = Object.freeze({
  course: 'courseId', unit: 'unitId', lesson: 'lessonId', module: 'moduleId',
});

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

/** Validate and normalize one authored expectation (a pacing target + due date). */
export function validateLearningExpectation(raw, { path = 'expectation' } = {}) {
  const errors = [];
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  if (raw.schema !== LEARNING_EXPECTATION_SCHEMA) errors.push(`${path}.schema: must be ${LEARNING_EXPECTATION_SCHEMA}`);
  if (!ID.test(raw.expectationId || '')) errors.push(`${path}.expectationId: must be a lowercase identifier`);
  if (!isText(raw.scopeType) || !isText(raw.scopeId)) errors.push(`${path}: scopeType and scopeId are required`);
  if (!isObject(raw.target) || !Object.hasOwn(EXPECTATION_TARGET_FIELD, raw.target?.kind) || !isText(raw.target?.id)) {
    errors.push(`${path}.target: requires course|unit|lesson|module kind and non-empty id`);
  }
  if (!isCanonicalTimestamp(raw.dueAt)) errors.push(`${path}.dueAt: must be a canonical ISO-8601 timestamp`);
  if (!Number.isInteger(raw.expectedCompletedPercent)
      || raw.expectedCompletedPercent < 1 || raw.expectedCompletedPercent > 100) {
    errors.push(`${path}.expectedCompletedPercent: must be an integer from 1 to 100`);
  }
  return errors.length ? { errors } : {
    errors,
    expectation: Object.freeze({
      schema: LEARNING_EXPECTATION_SCHEMA,
      expectationId: raw.expectationId,
      scopeType: String(raw.scopeType),
      scopeId: String(raw.scopeId),
      target: Object.freeze({ kind: raw.target.kind, id: String(raw.target.id) }),
      dueAt: raw.dueAt,
      expectedCompletedPercent: raw.expectedCompletedPercent,
    }),
  };
}

export default validateLearningExpectation;
