/**
 * Optional learner self-regulation evidence. These observations describe how
 * a learner planned, performed, or reflected; they never alter an academic
 * score and never assign a learner to an ability track.
 */

export const SELF_REGULATION_PHASES = Object.freeze([
  'forethought', 'performance', 'self_reflection',
]);

export const SELF_ASSESSMENTS = Object.freeze([
  'not_yet', 'uncertain', 'ready',
]);

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ALLOWED_FIELDS = new Set([
  'phase', 'confidence', 'selfAssessment', 'errorCategoryId', 'strategyIds',
  'nextAction', 'note',
]);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

export function normalizeSelfRegulation(raw, { path = 'selfRegulation' } = {}) {
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  const errors = [];
  const unknown = Object.keys(raw).filter((field) => !ALLOWED_FIELDS.has(field));
  if (unknown.length) errors.push(`${path}: unknown fields ${unknown.join(', ')}`);
  if (!SELF_REGULATION_PHASES.includes(raw.phase)) {
    errors.push(`${path}.phase: must be ${SELF_REGULATION_PHASES.join('|')}`);
  }
  if (raw.confidence !== undefined
      && (!Number.isInteger(raw.confidence) || raw.confidence < 1 || raw.confidence > 5)) {
    errors.push(`${path}.confidence: must be an integer from 1 to 5`);
  }
  if (raw.selfAssessment !== undefined && !SELF_ASSESSMENTS.includes(raw.selfAssessment)) {
    errors.push(`${path}.selfAssessment: must be ${SELF_ASSESSMENTS.join('|')}`);
  }
  if (raw.errorCategoryId !== undefined && !ID.test(raw.errorCategoryId)) {
    errors.push(`${path}.errorCategoryId: must be a lowercase identifier`);
  }
  const strategyIds = normalizeIds(raw.strategyIds, `${path}.strategyIds`, errors);
  let nextAction;
  if (raw.nextAction !== undefined) {
    if (!isObject(raw.nextAction) || !isText(raw.nextAction.type) || !isText(raw.nextAction.id)) {
      errors.push(`${path}.nextAction: requires non-empty type and id`);
    } else {
      const actionUnknown = Object.keys(raw.nextAction).filter((field) => !['type', 'id'].includes(field));
      if (actionUnknown.length) errors.push(`${path}.nextAction: unknown fields ${actionUnknown.join(', ')}`);
      nextAction = Object.freeze({ type: String(raw.nextAction.type), id: String(raw.nextAction.id) });
    }
  }
  if (raw.note !== undefined && (!isText(raw.note) || raw.note.length > 500)) {
    errors.push(`${path}.note: must be 1..500 characters when present`);
  }
  const hasObservation = raw.confidence !== undefined || raw.selfAssessment !== undefined
    || raw.errorCategoryId !== undefined || strategyIds.length > 0
    || raw.nextAction !== undefined || raw.note !== undefined;
  if (!hasObservation) errors.push(`${path}: must contain at least one observation`);
  if (errors.length) return { errors };
  return {
    errors,
    selfRegulation: Object.freeze({
      phase: raw.phase,
      ...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
      ...(raw.selfAssessment !== undefined ? { selfAssessment: raw.selfAssessment } : {}),
      ...(raw.errorCategoryId !== undefined ? { errorCategoryId: raw.errorCategoryId } : {}),
      strategyIds: Object.freeze(strategyIds),
      ...(nextAction ? { nextAction } : {}),
      ...(raw.note !== undefined ? { note: String(raw.note) } : {}),
    }),
  };
}

/** Aggregate reflection observations without mixing them into correctness. */
export function summarizeSelfRegulation(evidence) {
  const entries = evidence.filter((entry) => entry.selfRegulation);
  const phaseCounts = Object.fromEntries(SELF_REGULATION_PHASES.map((phase) => [phase, 0]));
  const confidence = Object.fromEntries(SELF_REGULATION_PHASES.map((phase) => [phase, { count: 0, total: 0 }]));
  const errors = new Map();
  const strategies = new Map();
  const selfAssessments = new Map();
  const nextActions = new Map();
  for (const entry of entries) {
    const reflection = entry.selfRegulation;
    phaseCounts[reflection.phase] += 1;
    if (reflection.confidence !== undefined) {
      confidence[reflection.phase].count += 1;
      confidence[reflection.phase].total += reflection.confidence;
    }
    count(errors, reflection.errorCategoryId);
    reflection.strategyIds.forEach((id) => count(strategies, id));
    count(selfAssessments, reflection.selfAssessment);
    if (reflection.nextAction) count(nextActions, `${reflection.nextAction.type}:${reflection.nextAction.id}`);
  }
  return Object.freeze({
    evidenceCount: entries.length,
    phaseCounts: Object.freeze(phaseCounts),
    confidence: Object.freeze(Object.fromEntries(Object.entries(confidence).map(([phase, value]) => [
      phase,
      Object.freeze({
        count: value.count,
        average: value.count === 0 ? null : Math.round((value.total / value.count) * 10) / 10,
      }),
    ]))),
    errorCategories: countedRows(errors),
    strategies: countedRows(strategies),
    selfAssessments: countedRows(selfAssessments),
    nextActions: countedRows(nextActions),
  });
}

function normalizeIds(raw, path, errors) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 8 || raw.some((id) => !ID.test(id))) {
    errors.push(`${path}: must contain at most 8 lowercase identifiers`);
    return [];
  }
  if (new Set(raw).size !== raw.length) errors.push(`${path}: must not contain duplicates`);
  return [...raw];
}

function count(map, key) {
  if (key !== undefined) map.set(key, (map.get(key) ?? 0) + 1);
}

function countedRows(map) {
  return Object.freeze([...map.entries()]
    .map(([id, evidenceCount]) => Object.freeze({ id, evidenceCount }))
    .sort((left, right) => right.evidenceCount - left.evidenceCount || left.id.localeCompare(right.id)));
}

