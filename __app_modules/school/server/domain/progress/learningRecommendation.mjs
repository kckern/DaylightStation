export const LEARNING_RECOMMENDATION_SCHEMA = 'school.learning-recommendation/v1';

const TARGET_KINDS = new Set(['concept', 'item', 'course', 'unit', 'lesson', 'module']);
const ACTION_KINDS = new Set(['review_instruction', 'review_pacing']);
const POLICY_VERSION = /^[a-z][a-z0-9.-]{0,63}\/v[1-9][0-9]*$/;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Closed, expiring recommendation record. It describes a reversible action
 * justified by scoped evidence; it cannot represent rank, ability tier, or
 * permanent placement.
 */
export function createLearningRecommendation(raw = {}) {
  if (!isObject(raw)) throw new TypeError('Learning recommendation must be a mapping');
  exactKeys(raw, [
    'recommendationId', 'audience', 'scope', 'target', 'actionKind', 'basis',
    'policyVersion', 'generatedAt', 'expiresAt',
  ], 'learning recommendation');
  const {
    recommendationId, audience = 'adult', scope, target, actionKind, basis,
    policyVersion, generatedAt, expiresAt,
  } = raw;
  if (isObject(scope)) exactKeys(scope, ['type', 'id'], 'learning recommendation scope');
  if (isObject(target)) exactKeys(target, ['kind', 'id'], 'learning recommendation target');
  if (!isText(recommendationId) || recommendationId.length > 255
      || audience !== 'adult' || !validScope(scope) || !validTarget(target)
      || !ACTION_KINDS.has(actionKind) || !POLICY_VERSION.test(policyVersion || '')
      || !isCanonicalTimestamp(generatedAt) || !isCanonicalTimestamp(expiresAt)
      || expiresAt <= generatedAt) {
    throw new TypeError('Learning recommendation identity, scope, policy, or expiry is invalid');
  }
  const normalizedBasis = normalizeBasis(basis);
  if (normalizedBasis.kind === 'evidence_aggregate'
      && normalizedBasis.lastEvidenceAt > generatedAt) {
    throw new TypeError('Learning recommendation cannot precede its evidence');
  }
  return deepFreeze({
    schema: LEARNING_RECOMMENDATION_SCHEMA,
    recommendationId,
    audience,
    scope: { type: String(scope.type), id: String(scope.id) },
    target: { kind: target.kind, id: String(target.id) },
    action: { kind: actionKind, target: { kind: target.kind, id: String(target.id) } },
    basis: normalizedBasis,
    policy: {
      version: policyVersion,
      generatedAt,
      expiresAt,
      reassessOnNewEvidence: true,
    },
    constraints: {
      learnerRanking: false,
      permanentAbilityLabels: false,
      fixedPlacement: false,
    },
  });
}

/** Cached projections must stop presenting a recommendation at its expiry. */
export function isLearningRecommendationActive(recommendation, { asOf } = {}) {
  if (!isCanonicalTimestamp(asOf)) throw new TypeError('Recommendation activity check requires a canonical asOf time');
  return recommendation?.schema === LEARNING_RECOMMENDATION_SCHEMA
    && isCanonicalTimestamp(recommendation?.policy?.expiresAt)
    && asOf < recommendation.policy.expiresAt;
}

function normalizeBasis(raw) {
  if (!isObject(raw)) throw new TypeError('Learning recommendation basis is required');
  if (raw.kind === 'evidence_aggregate') {
    exactKeys(raw, [
      'kind', 'evidenceCount', 'responseCount', 'correctCount', 'learnerCount',
      'firstEvidenceAt', 'lastEvidenceAt',
    ], 'evidence aggregate basis');
    for (const field of ['evidenceCount', 'responseCount', 'correctCount', 'learnerCount']) {
      if (!Number.isInteger(raw[field]) || raw[field] < 0) {
        throw new TypeError(`Learning recommendation ${field} must be a nonnegative integer`);
      }
    }
    if (raw.correctCount > raw.responseCount || raw.learnerCount > raw.evidenceCount
        || !isCanonicalTimestamp(raw.firstEvidenceAt)
        || !isCanonicalTimestamp(raw.lastEvidenceAt)
        || raw.firstEvidenceAt > raw.lastEvidenceAt) {
      throw new TypeError('Learning recommendation evidence aggregate is inconsistent');
    }
    return {
      kind: raw.kind,
      evidenceCount: raw.evidenceCount,
      responseCount: raw.responseCount,
      correctCount: raw.correctCount,
      learnerCount: raw.learnerCount,
      firstEvidenceAt: raw.firstEvidenceAt,
      lastEvidenceAt: raw.lastEvidenceAt,
    };
  }
  if (raw.kind === 'authored_expectation') {
    exactKeys(raw, [
      'kind', 'expectationId', 'dueAt', 'expectedCompletedPercent',
      'completedLearnerCount', 'learnerCount',
    ], 'authored expectation basis');
    if (!isText(raw.expectationId) || !isCanonicalTimestamp(raw.dueAt)) {
      throw new TypeError('Learning recommendation expectation identity/time is invalid');
    }
    for (const field of ['expectedCompletedPercent', 'completedLearnerCount', 'learnerCount']) {
      if (!Number.isInteger(raw[field]) || raw[field] < 0) {
        throw new TypeError(`Learning recommendation ${field} must be a nonnegative integer`);
      }
    }
    if (raw.expectedCompletedPercent > 100 || raw.learnerCount < 1
        || raw.completedLearnerCount > raw.learnerCount) {
      throw new TypeError('Learning recommendation expectation aggregate is inconsistent');
    }
    return {
      kind: raw.kind,
      expectationId: raw.expectationId,
      dueAt: raw.dueAt,
      expectedCompletedPercent: raw.expectedCompletedPercent,
      completedLearnerCount: raw.completedLearnerCount,
      learnerCount: raw.learnerCount,
    };
  }
  throw new TypeError('Learning recommendation basis kind is unsupported');
}

function exactKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new TypeError(`${label} has unknown fields: ${extras.join(', ')}`);
}

function validScope(value) { return isObject(value) && isText(value.type) && isText(value.id); }
function validTarget(value) { return isObject(value) && TARGET_KINDS.has(value.kind) && isText(value.id); }
function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

export default createLearningRecommendation;
