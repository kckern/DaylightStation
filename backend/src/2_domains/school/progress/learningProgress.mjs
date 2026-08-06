import { normalizeSelfRegulation, summarizeSelfRegulation } from './selfRegulation.mjs';

/**
 * School learning-progress model. Pure domain code: no clocks, persistence,
 * HTTP, device families, or subject-specific rules.
 *
 * Progress is derived from append-only evidence. A snapshot is disposable;
 * evidence is the auditable source of truth so reassignment and new reporting
 * policy can always be replayed without repairing stored counters.
 */

export const LEARNING_EVIDENCE_SCHEMA = 'school.learning-evidence/v1';
export const LEARNING_PROGRESS_SCHEMA = 'school.learning-progress/v1';
export const ACADEMIC_PERIOD_SCHEMA = 'school.academic-period/v1';

export const EVIDENCE_VERIFICATIONS = Object.freeze([
  'verified', 'self_reported', 'pending',
]);

export const FOLLOW_UP_KINDS = Object.freeze([
  'continue', 'next_unit', 'next_lesson', 'next_quiz', 'remediation', 'review',
]);

export const FOLLOW_UP_AVAILABILITY = Object.freeze([
  'ready', 'requires_connection', 'requires_install', 'blocked',
]);

export const PROGRESS_GROUP_DIMENSIONS = Object.freeze([
  'learner', 'subject', 'area', 'course', 'unit', 'lesson', 'module',
  'concept', 'classification', 'tag', 'activity', 'activity_kind', 'surface',
  'verification', 'day', 'month',
]);

/**
 * The canonical authored-learning spine used by progress/history views.
 * Subjects remain data: these are structural roles, never subject names.
 */
export const CURRICULUM_HISTORY_LEVELS = Object.freeze([
  Object.freeze({ kind: 'catalog', field: 'catalogId' }),
  Object.freeze({ kind: 'subject', field: 'subjectId' }),
  Object.freeze({ kind: 'course', field: 'courseId' }),
  Object.freeze({ kind: 'unit', field: 'unitId' }),
  Object.freeze({ kind: 'lesson', field: 'lessonId' }),
  Object.freeze({ kind: 'module', field: 'moduleId' }),
]);

const MAX_LIST = 128;
const MAX_GROUP_BY = 3;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

/** Normalize reusable curriculum dimensions carried by any evidence source. */
export function normalizeLearningContext(raw = {}, { path = 'learning' } = {}) {
  if (raw === null || raw === undefined) return { errors: [], learning: emptyLearningContext() };
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  const errors = [];
  const learning = {};
  for (const field of ['catalogId', 'subjectId', 'courseId', 'unitId', 'lessonId', 'moduleId']) {
    if (raw[field] === undefined || raw[field] === null) continue;
    if (!isText(raw[field])) errors.push(`${path}.${field}: must be non-empty text`);
    else learning[field] = String(raw[field]);
  }
  for (const field of ['areaIds', 'conceptIds', 'classifications', 'tags']) {
    const result = normalizeTextList(raw[field], `${path}.${field}`);
    errors.push(...result.errors);
    learning[field] = result.values;
  }
  return errors.length ? { errors } : { errors, learning: Object.freeze({
    ...emptyLearningContext(), ...learning,
  }) };
}

/** Validate and normalize one append-only piece of learning evidence. */
export function validateLearningEvidence(raw, { path = 'evidence' } = {}) {
  const errors = [];
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  if (raw.schema !== LEARNING_EVIDENCE_SCHEMA) errors.push(`${path}.schema: must be ${LEARNING_EVIDENCE_SCHEMA}`);
  for (const field of ['evidenceId', 'learnerId']) {
    if (!isText(raw[field])) errors.push(`${path}.${field}: is required`);
  }
  if (!isCanonicalTimestamp(raw.occurredAt)) errors.push(`${path}.occurredAt: must be a canonical ISO-8601 timestamp`);
  if (raw.observedAt !== undefined && !isCanonicalTimestamp(raw.observedAt)) {
    errors.push(`${path}.observedAt: must be a canonical ISO-8601 timestamp`);
  }
  if (!EVIDENCE_VERIFICATIONS.includes(raw.verification)) {
    errors.push(`${path}.verification: must be ${EVIDENCE_VERIFICATIONS.join('|')}`);
  }

  const activity = normalizeActivity(raw.activity, `${path}.activity`, errors);
  const learningResult = normalizeLearningContext(raw.learning, { path: `${path}.learning` });
  errors.push(...learningResult.errors);
  const measures = normalizeMeasures(raw.measures, `${path}.measures`, errors);
  const source = normalizeSource(raw.source, `${path}.source`, errors);
  const selfRegulationResult = raw.selfRegulation === undefined
    ? { errors: [], selfRegulation: null }
    : normalizeSelfRegulation(raw.selfRegulation, { path: `${path}.selfRegulation` });
  errors.push(...selfRegulationResult.errors);
  if (errors.length) return { errors };

  return {
    errors,
    evidence: Object.freeze({
      schema: LEARNING_EVIDENCE_SCHEMA,
      evidenceId: String(raw.evidenceId),
      learnerId: String(raw.learnerId),
      occurredAt: raw.occurredAt,
      ...(raw.observedAt ? { observedAt: raw.observedAt } : {}),
      verification: raw.verification,
      activity,
      learning: learningResult.learning,
      measures,
      source,
      ...(selfRegulationResult.selfRegulation
        ? { selfRegulation: selfRegulationResult.selfRegulation }
        : {}),
    }),
  };
}

/** Arbitrary named term/semester/season with an exclusive end boundary. */
export function validateAcademicPeriod(raw, { path = 'period' } = {}) {
  const errors = [];
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  if (raw.schema !== ACADEMIC_PERIOD_SCHEMA) errors.push(`${path}.schema: must be ${ACADEMIC_PERIOD_SCHEMA}`);
  for (const field of ['periodId', 'kind', 'label']) {
    if (!isText(raw[field])) errors.push(`${path}.${field}: is required`);
  }
  if (!isCanonicalTimestamp(raw.startsAt)) errors.push(`${path}.startsAt: must be a canonical ISO-8601 timestamp`);
  if (!isCanonicalTimestamp(raw.endsAt)) errors.push(`${path}.endsAt: must be a canonical ISO-8601 timestamp`);
  if (isCanonicalTimestamp(raw.startsAt) && isCanonicalTimestamp(raw.endsAt)
      && raw.startsAt >= raw.endsAt) errors.push(`${path}: startsAt must precede endsAt`);
  if (raw.parentPeriodId !== undefined && !isText(raw.parentPeriodId)) {
    errors.push(`${path}.parentPeriodId: must be non-empty text when present`);
  }
  return errors.length ? { errors } : {
    errors,
    period: Object.freeze({
      schema: ACADEMIC_PERIOD_SCHEMA,
      periodId: String(raw.periodId), kind: String(raw.kind), label: String(raw.label),
      startsAt: raw.startsAt, endsAt: raw.endsAt,
      ...(raw.parentPeriodId ? { parentPeriodId: String(raw.parentPeriodId) } : {}),
    }),
  };
}

/** A learner or an application-resolved cohort (household, classroom, etc.). */
export function normalizeLearningScope(raw, { path = 'scope' } = {}) {
  const errors = [];
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  for (const field of ['type', 'id', 'label']) {
    if (!isText(raw[field])) errors.push(`${path}.${field}: is required`);
  }
  const learnerIds = normalizeTextList(raw.learnerIds, `${path}.learnerIds`, { required: true });
  errors.push(...learnerIds.errors);
  if (raw.type === 'learner' && learnerIds.values.length !== 1) {
    errors.push(`${path}.learnerIds: learner scope must resolve exactly one learner`);
  }
  return errors.length ? { errors } : {
    errors,
    scope: Object.freeze({
      type: String(raw.type), id: String(raw.id), label: String(raw.label),
      learnerIds: Object.freeze(learnerIds.values),
    }),
  };
}

/** Normalize reusable progress filters; empty lists mean unrestricted. */
export function normalizeProgressFilters(raw = {}, { path = 'filters' } = {}) {
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  const errors = [];
  const filters = {};
  for (const field of [
    'subjectIds', 'areaIds', 'courseIds', 'unitIds', 'lessonIds', 'moduleIds',
    'conceptIds', 'activityKinds', 'surfaceIds', 'includeClassifications',
    'excludeClassifications', 'includeTags', 'excludeTags', 'verifications',
  ]) {
    const result = normalizeTextList(raw[field], `${path}.${field}`);
    errors.push(...result.errors);
    filters[field] = result.values;
  }
  if (filters.verifications.some((value) => !EVIDENCE_VERIFICATIONS.includes(value))) {
    errors.push(`${path}.verifications: contains an unknown verification state`);
  }
  return errors.length ? { errors } : { errors, filters: Object.freeze(filters) };
}

/** Structured, surface-neutral next action returned with a progress snapshot. */
export function normalizeFollowUpAction(raw, { path = 'followUp' } = {}) {
  const errors = [];
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  if (!isText(raw.actionId)) errors.push(`${path}.actionId: is required`);
  if (!FOLLOW_UP_KINDS.includes(raw.kind)) errors.push(`${path}.kind: must be ${FOLLOW_UP_KINDS.join('|')}`);
  if (!isText(raw.label)) errors.push(`${path}.label: is required`);
  if (!FOLLOW_UP_AVAILABILITY.includes(raw.availability)) {
    errors.push(`${path}.availability: must be ${FOLLOW_UP_AVAILABILITY.join('|')}`);
  }
  if (!isObject(raw.target) || !isText(raw.target.type) || !isText(raw.target.id)) {
    errors.push(`${path}.target: requires non-empty type and id`);
  }
  if (raw.learnerId !== undefined && !isText(raw.learnerId)) errors.push(`${path}.learnerId: must be non-empty text`);
  if (raw.reason !== undefined && !isText(raw.reason)) errors.push(`${path}.reason: must be non-empty text`);
  if (raw.priority !== undefined && (!Number.isInteger(raw.priority) || raw.priority < 0 || raw.priority > 1000)) {
    errors.push(`${path}.priority: must be an integer from 0 to 1000`);
  }
  return errors.length ? { errors } : {
    errors,
    action: Object.freeze({
      actionId: String(raw.actionId), kind: raw.kind, label: String(raw.label),
      availability: raw.availability,
      target: Object.freeze({ type: String(raw.target.type), id: String(raw.target.id) }),
      ...(raw.learnerId ? { learnerId: String(raw.learnerId) } : {}),
      ...(raw.reason ? { reason: String(raw.reason) } : {}),
      priority: raw.priority ?? 100,
    }),
  };
}

/**
 * Filter and roll up validated evidence into one cross-surface snapshot.
 * `generatedAt` is supplied by the application; this domain code never reads
 * a wall clock.
 */
export function aggregateLearningProgress({
  evidence = [], scope, window = {}, filters = {}, groupBy = [],
  followUps = [], generatedAt, recentLimit = 10,
} = {}) {
  const scopeResult = normalizeLearningScope(scope);
  if (scopeResult.errors.length) throw new TypeError(scopeResult.errors.join('; '));
  if (!isCanonicalTimestamp(generatedAt)) throw new TypeError('generatedAt must be a canonical ISO-8601 timestamp');
  const normalizedWindow = normalizeWindow(window);
  const filterResult = normalizeProgressFilters(filters);
  if (filterResult.errors.length) throw new TypeError(filterResult.errors.join('; '));
  const dimensions = normalizeGroupBy(groupBy);
  if (!Number.isInteger(recentLimit) || recentLimit < 0 || recentLimit > 100) {
    throw new TypeError('recentLimit must be an integer from 0 to 100');
  }

  const normalizedEvidence = evidence.map((entry, index) => {
    const result = validateLearningEvidence(entry, { path: `evidence[${index}]` });
    if (result.errors.length) throw new TypeError(result.errors.join('; '));
    return result.evidence;
  });
  const learnerSet = new Set(scopeResult.scope.learnerIds);
  const scoped = normalizedEvidence.filter((entry) => learnerSet.has(entry.learnerId)
    && withinWindow(entry.occurredAt, normalizedWindow));
  const selected = scoped.filter((entry) => matchesFilters(entry, filterResult.filters));

  const actions = followUps.map((entry, index) => {
    const result = normalizeFollowUpAction(entry, { path: `followUps[${index}]` });
    if (result.errors.length) throw new TypeError(result.errors.join('; '));
    return result.action;
  }).filter((action) => !action.learnerId || learnerSet.has(action.learnerId))
    .sort((a, b) => a.priority - b.priority || a.actionId.localeCompare(b.actionId));

  return Object.freeze({
    schema: LEARNING_PROGRESS_SCHEMA,
    generatedAt,
    scope: scopeResult.scope,
    window: normalizedWindow,
    filters: filterResult.filters,
    summary: summarizeEvidence(selected),
    facets: buildFacets(selected),
    breakdowns: buildBreakdowns(selected, dimensions),
    curriculumHistory: buildCurriculumHistory(selected),
    selfRegulation: summarizeSelfRegulation(selected),
    recentScores: buildRecentScores(selected).slice(0, recentLimit),
    followUps: Object.freeze(actions),
  });
}

/**
 * Build an evidence-backed, subject-neutral curriculum tree for overview /
 * focus / inspector surfaces. Only paths actually present in evidence appear.
 * Consequently this deliberately does not infer "complete" or "not started"
 * for an authored unit: those coverage claims require a curriculum outline.
 */
export function buildCurriculumHistory(entries = []) {
  const rootMap = new Map();
  const unscoped = [];

  entries.forEach((entry) => {
    const pathParts = CURRICULUM_HISTORY_LEVELS
      .map(({ kind, field }) => ({ kind, field, id: entry.learning[field] }))
      .filter(({ id }) => isText(id));
    if (pathParts.length === 0) {
      unscoped.push(entry);
      return;
    }

    let siblings = rootMap;
    const path = {};
    pathParts.forEach(({ kind, field, id }, index) => {
      path[field] = id;
      const key = curriculumPathKey(path);
      const node = siblings.get(key) ?? {
        key, kind, id, path: { ...path }, entries: [], directEntries: [], children: new Map(),
      };
      node.entries.push(entry);
      if (index === pathParts.length - 1) node.directEntries.push(entry);
      siblings.set(key, node);
      siblings = node.children;
    });
  });

  return Object.freeze({
    hierarchy: CURRICULUM_HISTORY_LEVELS.map(({ kind }) => kind),
    roots: Object.freeze(finalizeCurriculumNodes(rootMap)),
    unscoped: summarizeEvidence(unscoped),
  });
}

/**
 * Conservative generic remediation affordance: offer review after a graded
 * assessment below threshold. It does not guess what lesson comes next; that
 * requires a curriculum-aware provider. One latest action per learner avoids
 * turning My Progress into a wall of old failures.
 */
export function deriveAssessmentReviewFollowUps(evidence, {
  thresholdPercent = 80, maxPerLearner = 1,
} = {}) {
  if (!Number.isInteger(thresholdPercent) || thresholdPercent < 0 || thresholdPercent > 100) {
    throw new TypeError('review thresholdPercent must be an integer from 0 to 100');
  }
  if (!Number.isInteger(maxPerLearner) || maxPerLearner < 0 || maxPerLearner > 20) {
    throw new TypeError('review maxPerLearner must be an integer from 0 to 20');
  }
  const normalized = evidence.map((entry, index) => {
    const result = validateLearningEvidence(entry, { path: `evidence[${index}]` });
    if (result.errors.length) throw new TypeError(result.errors.join('; '));
    return result.evidence;
  });
  const counts = new Map();
  return buildRecentScores(normalized).filter((assessment) => {
    if (assessment.score.percent >= thresholdPercent) return false;
    const used = counts.get(assessment.learnerId) ?? 0;
    if (used >= maxPerLearner) return false;
    counts.set(assessment.learnerId, used + 1);
    return true;
  }).map((assessment) => Object.freeze({
    actionId: `review:${assessment.learnerId}:${assessment.assessmentId}`,
    learnerId: assessment.learnerId,
    kind: 'review',
    label: 'Review this quiz',
    availability: 'ready',
    target: Object.freeze({ type: 'bank', id: assessment.activityId }),
    reason: `${assessment.score.percent}% was below the ${thresholdPercent}% review threshold`,
    priority: 30,
  }));
}

function normalizeActivity(raw, path, errors) {
  if (!isObject(raw)) { errors.push(`${path}: must be a mapping`); return null; }
  if (!isText(raw.id)) errors.push(`${path}.id: is required`);
  if (!isText(raw.kind)) errors.push(`${path}.kind: is required`);
  // `!= null` (not `!== undefined`): an untracked scan attempt carries a real
  // `sessionId: null` (and, before an assessmentId is derivable, the same for
  // assessmentId) rather than omitting the key — that must stay optional, not
  // become a validation failure.
  for (const field of ['sessionId', 'itemId', 'assessmentId']) {
    if (raw[field] != null && !isText(raw[field])) errors.push(`${path}.${field}: must be non-empty text`);
  }
  if (raw.attemptNumber !== undefined
      && (!Number.isInteger(raw.attemptNumber) || raw.attemptNumber < 1 || raw.attemptNumber > 255)) {
    errors.push(`${path}.attemptNumber: must be an integer from 1 to 255`);
  }
  if (raw.action !== undefined && !isText(raw.action)) errors.push(`${path}.action: must be non-empty text`);
  if (raw.graded !== undefined && typeof raw.graded !== 'boolean') errors.push(`${path}.graded: must be boolean`);
  return Object.freeze({
    id: String(raw.id ?? ''), kind: String(raw.kind ?? ''), graded: raw.graded === true,
    ...(raw.sessionId ? { sessionId: String(raw.sessionId) } : {}),
    ...(raw.itemId ? { itemId: String(raw.itemId) } : {}),
    ...(raw.assessmentId ? { assessmentId: String(raw.assessmentId) } : {}),
    ...(raw.attemptNumber !== undefined ? { attemptNumber: raw.attemptNumber } : {}),
    ...(raw.action ? { action: String(raw.action) } : {}),
  });
}

function normalizeMeasures(raw, path, errors) {
  if (!isObject(raw)) { errors.push(`${path}: must be a mapping`); return null; }
  const measures = {};
  for (const field of ['engagements', 'responses', 'correct', 'completions', 'durationMs']) {
    const value = raw[field] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0) errors.push(`${path}.${field}: must be a non-negative safe integer`);
    measures[field] = value;
  }
  if (measures.correct > measures.responses) errors.push(`${path}.correct: cannot exceed responses`);
  const hasPosition = raw.position !== undefined || raw.total !== undefined;
  if (hasPosition) {
    if (!Number.isSafeInteger(raw.position) || raw.position < 0) errors.push(`${path}.position: must be a non-negative safe integer`);
    if (!Number.isSafeInteger(raw.total) || raw.total <= 0) errors.push(`${path}.total: must be a positive safe integer`);
    if (Number.isSafeInteger(raw.position) && Number.isSafeInteger(raw.total) && raw.position > raw.total) {
      errors.push(`${path}.position: cannot exceed total`);
    }
    measures.position = raw.position;
    measures.total = raw.total;
  }
  if (!Object.values(measures).some((value) => Number.isFinite(value) && value > 0)) {
    errors.push(`${path}: must contain at least one positive measure`);
  }
  return Object.freeze(measures);
}

function normalizeSource(raw, path, errors) {
  if (!isObject(raw)) { errors.push(`${path}: must be a mapping`); return null; }
  for (const field of ['surface', 'transport']) {
    if (!isText(raw[field])) errors.push(`${path}.${field}: is required`);
  }
  if (raw.deviceId !== undefined && !isText(raw.deviceId)) errors.push(`${path}.deviceId: must be non-empty text`);
  return Object.freeze({
    surface: String(raw.surface ?? ''), transport: String(raw.transport ?? ''),
    ...(raw.deviceId ? { deviceId: String(raw.deviceId) } : {}),
  });
}

function normalizeWindow(raw) {
  if (!isObject(raw)) throw new TypeError('window must be a mapping');
  let period = null;
  if (raw.period !== undefined && raw.period !== null) {
    const result = validateAcademicPeriod(raw.period, { path: 'window.period' });
    if (result.errors.length) throw new TypeError(result.errors.join('; '));
    period = result.period;
  }
  const from = raw.from ?? period?.startsAt ?? null;
  const to = raw.to ?? period?.endsAt ?? null;
  if (from !== null && !isCanonicalTimestamp(from)) throw new TypeError('window.from must be a canonical ISO-8601 timestamp');
  if (to !== null && !isCanonicalTimestamp(to)) throw new TypeError('window.to must be a canonical ISO-8601 timestamp');
  if (from !== null && to !== null && from >= to) throw new TypeError('window.from must precede window.to');
  return Object.freeze({ from, to, ...(period ? { period } : {}) });
}

function normalizeGroupBy(raw) {
  if (!Array.isArray(raw) || raw.length > MAX_GROUP_BY) {
    throw new TypeError(`groupBy must be an array of at most ${MAX_GROUP_BY} dimensions`);
  }
  if (new Set(raw).size !== raw.length || raw.some((entry) => !PROGRESS_GROUP_DIMENSIONS.includes(entry))) {
    throw new TypeError('groupBy contains a duplicate or unknown dimension');
  }
  return [...raw];
}

function matchesFilters(entry, filters) {
  const learning = entry.learning;
  if (!matchesScalar(learning.subjectId, filters.subjectIds)) return false;
  if (!matchesAny(learning.areaIds, filters.areaIds)) return false;
  if (!matchesScalar(learning.courseId, filters.courseIds)) return false;
  if (!matchesScalar(learning.unitId, filters.unitIds)) return false;
  if (!matchesScalar(learning.lessonId, filters.lessonIds)) return false;
  if (!matchesScalar(learning.moduleId, filters.moduleIds)) return false;
  if (!matchesAny(learning.conceptIds, filters.conceptIds)) return false;
  if (!matchesScalar(entry.activity.kind, filters.activityKinds)) return false;
  if (!matchesScalar(entry.source.surface, filters.surfaceIds)) return false;
  if (!matchesScalar(entry.verification, filters.verifications)) return false;
  if (!matchesAny(learning.classifications, filters.includeClassifications)) return false;
  if (!matchesAny(learning.tags, filters.includeTags)) return false;
  if (intersects(learning.classifications, filters.excludeClassifications)) return false;
  if (intersects(learning.tags, filters.excludeTags)) return false;
  return true;
}

function summarizeEvidence(entries) {
  const totals = {
    evidenceCount: entries.length,
    engagementCount: 0,
    responseCount: 0,
    correctCount: 0,
    completionCount: 0,
    durationMs: 0,
    activityCount: 0,
    assessmentCount: 0,
    verifiedCount: 0,
    selfReportedCount: 0,
    pendingCount: 0,
    scorePercent: null,
    lastActivityAt: null,
  };
  const activities = new Set();
  const assessments = new Set();
  for (const entry of entries) {
    totals.engagementCount += entry.measures.engagements;
    totals.responseCount += entry.measures.responses;
    totals.correctCount += entry.measures.correct;
    totals.completionCount += entry.measures.completions;
    totals.durationMs += entry.measures.durationMs;
    totals[`${camelVerification(entry.verification)}Count`] += 1;
    activities.add(`${entry.learnerId}\u0000${entry.activity.sessionId ?? entry.activity.id}`);
    if (entry.activity.graded && entry.measures.responses > 0) {
      assessments.add(`${entry.learnerId}\u0000${entry.activity.sessionId ?? entry.activity.id}`);
    }
    if (totals.lastActivityAt === null || entry.occurredAt > totals.lastActivityAt) {
      totals.lastActivityAt = entry.occurredAt;
    }
  }
  totals.activityCount = activities.size;
  totals.assessmentCount = assessments.size;
  totals.scorePercent = totals.responseCount
    ? Math.round((totals.correctCount / totals.responseCount) * 100)
    : null;
  return Object.freeze(totals);
}

function buildRecentScores(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    if (!entry.activity.graded || entry.measures.responses === 0) continue;
    // assessmentId (a session, or a scanned card's record id) first; sessionId
    // kept in the chain for evidence written before assessmentId existed.
    const assessmentId = entry.activity.assessmentId ?? entry.activity.sessionId ?? entry.evidenceId;
    const key = `${entry.learnerId}\u0000${assessmentId}`;
    const current = grouped.get(key) ?? {
      assessmentId,
      learnerId: entry.learnerId,
      activityId: entry.activity.id,
      activityKind: entry.activity.kind,
      occurredAt: entry.occurredAt,
      correct: 0,
      total: 0,
      verification: entry.verification,
      learning: entry.learning,
      source: entry.source,
    };
    current.correct += entry.measures.correct;
    current.total += entry.measures.responses;
    if (entry.occurredAt > current.occurredAt) current.occurredAt = entry.occurredAt;
    current.verification = lessCertain(current.verification, entry.verification);
    grouped.set(key, current);
  }
  return [...grouped.values()].map((entry) => Object.freeze({
    assessmentId: entry.assessmentId,
    learnerId: entry.learnerId,
    activityId: entry.activityId,
    activityKind: entry.activityKind,
    occurredAt: entry.occurredAt,
    score: Object.freeze({
      correct: entry.correct, total: entry.total,
      percent: Math.round((entry.correct / entry.total) * 100),
    }),
    verification: entry.verification,
    learning: entry.learning,
    source: entry.source,
  })).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)
    || a.assessmentId.localeCompare(b.assessmentId));
}

function buildFacets(entries) {
  const definitions = {
    learners: (entry) => [entry.learnerId],
    subjects: (entry) => values(entry.learning.subjectId),
    areas: (entry) => entry.learning.areaIds,
    courses: (entry) => values(entry.learning.courseId),
    classifications: (entry) => entry.learning.classifications,
    activityKinds: (entry) => [entry.activity.kind],
    surfaces: (entry) => [entry.source.surface],
    verifications: (entry) => [entry.verification],
  };
  return Object.freeze(Object.fromEntries(Object.entries(definitions).map(([name, getter]) => {
    const counts = new Map();
    entries.forEach((entry) => [...new Set(getter(entry))].forEach((key) => {
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }));
    return [name, Object.freeze([...counts.entries()]
      .map(([id, evidenceCount]) => Object.freeze({ id, evidenceCount }))
      .sort((a, b) => a.id.localeCompare(b.id)))];
  })));
}

function buildBreakdowns(entries, dimensions) {
  if (dimensions.length === 0) return Object.freeze([]);
  const groups = new Map();
  for (const entry of entries) {
    for (const parts of groupParts(entry, dimensions)) {
      const key = parts.map((part) => `${part.dimension}=${part.value}`).join('|');
      const group = groups.get(key) ?? { key, dimensions: Object.fromEntries(parts.map((part) => [part.dimension, part.value])), entries: [] };
      group.entries.push(entry);
      groups.set(key, group);
    }
  }
  return Object.freeze([...groups.values()].map((group) => Object.freeze({
    key: group.key,
    dimensions: Object.freeze(group.dimensions),
    summary: summarizeEvidence(group.entries),
  })).sort((a, b) => a.key.localeCompare(b.key)));
}

function finalizeCurriculumNodes(nodes) {
  return [...nodes.values()].map((node) => Object.freeze({
    key: node.key,
    kind: node.kind,
    id: node.id,
    path: Object.freeze(node.path),
    // Direct evidence is useful in an inspector; summary rolls up this node
    // and all descendants, so a parent remains a truthful aggregate.
    directEvidenceCount: node.directEntries.length,
    evidenceState: 'recorded',
    summary: summarizeEvidence(node.entries),
    children: Object.freeze(finalizeCurriculumNodes(node.children)),
  })).sort((left, right) => (
    (right.summary.lastActivityAt ?? '').localeCompare(left.summary.lastActivityAt ?? '')
    || left.id.localeCompare(right.id)
    || left.key.localeCompare(right.key)
  ));
}

function curriculumPathKey(path) {
  return CURRICULUM_HISTORY_LEVELS
    .filter(({ field }) => isText(path[field]))
    .map(({ kind, field }) => `${kind}=${encodeURIComponent(path[field])}`)
    .join('|');
}

function groupParts(entry, dimensions) {
  let combinations = [[]];
  for (const dimension of dimensions) {
    const dimensionValues = valuesForDimension(entry, dimension);
    if (dimensionValues.length === 0) return [];
    combinations = combinations.flatMap((parts) => dimensionValues.map((value) => [
      ...parts, { dimension, value },
    ]));
  }
  return combinations;
}

function valuesForDimension(entry, dimension) {
  const scalar = {
    learner: entry.learnerId,
    subject: entry.learning.subjectId,
    course: entry.learning.courseId,
    unit: entry.learning.unitId,
    lesson: entry.learning.lessonId,
    module: entry.learning.moduleId,
    activity: entry.activity.id,
    activity_kind: entry.activity.kind,
    surface: entry.source.surface,
    verification: entry.verification,
    day: entry.occurredAt.slice(0, 10),
    month: entry.occurredAt.slice(0, 7),
  }[dimension];
  if (scalar !== undefined) return values(scalar);
  return [...new Set({
    area: entry.learning.areaIds,
    concept: entry.learning.conceptIds,
    classification: entry.learning.classifications,
    tag: entry.learning.tags,
  }[dimension] ?? [])];
}

function normalizeTextList(raw, path, { required = false } = {}) {
  if (raw === undefined || raw === null) {
    return required ? { errors: [`${path}: is required`], values: [] } : { errors: [], values: [] };
  }
  if (!Array.isArray(raw) || raw.length > MAX_LIST || raw.some((value) => !isText(value))) {
    return { errors: [`${path}: must be an array of at most ${MAX_LIST} non-empty strings`], values: [] };
  }
  const values = raw.map(String);
  if (new Set(values).size !== values.length) return { errors: [`${path}: must not contain duplicates`], values: [] };
  if (required && values.length === 0) return { errors: [`${path}: must not be empty`], values: [] };
  return { errors: [], values };
}

function emptyLearningContext() {
  return { areaIds: [], conceptIds: [], classifications: [], tags: [] };
}

function withinWindow(timestamp, window) {
  return (window.from === null || timestamp >= window.from)
    && (window.to === null || timestamp < window.to);
}

function matchesScalar(value, allowed) { return allowed.length === 0 || (value != null && allowed.includes(value)); }
function matchesAny(actual, allowed) { return allowed.length === 0 || intersects(actual, allowed); }
function intersects(left, right) { const set = new Set(right); return left.some((value) => set.has(value)); }
function values(value) { return value === undefined || value === null || value === '' ? [] : [value]; }
function camelVerification(value) { return value === 'self_reported' ? 'selfReported' : value; }

function lessCertain(left, right) {
  const order = { verified: 0, self_reported: 1, pending: 2 };
  return order[left] >= order[right] ? left : right;
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}
