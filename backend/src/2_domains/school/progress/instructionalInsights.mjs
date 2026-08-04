import { validateLearningEvidence } from './learningProgress.mjs';
import { createLearningRecommendation } from './learningRecommendation.mjs';

export const LEARNING_EXPECTATION_SCHEMA = 'school.learning-expectation/v1';
export const INSTRUCTIONAL_INSIGHTS_SCHEMA = 'school.instructional-insights/v1';

const TARGET_FIELD = Object.freeze({
  course: 'courseId', unit: 'unitId', lesson: 'lessonId', module: 'moduleId',
});
const SIGNAL_ORDER = Object.freeze({ review_instruction: 0, limited_evidence: 1, monitor: 2 });
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;

export function validateLearningExpectation(raw, { path = 'expectation' } = {}) {
  const errors = [];
  if (!isObject(raw)) return { errors: [`${path}: must be a mapping`] };
  if (raw.schema !== LEARNING_EXPECTATION_SCHEMA) errors.push(`${path}.schema: must be ${LEARNING_EXPECTATION_SCHEMA}`);
  if (!ID.test(raw.expectationId || '')) errors.push(`${path}.expectationId: must be a lowercase identifier`);
  if (!isText(raw.scopeType) || !isText(raw.scopeId)) errors.push(`${path}: scopeType and scopeId are required`);
  if (!isObject(raw.target) || !Object.hasOwn(TARGET_FIELD, raw.target?.kind) || !isText(raw.target?.id)) {
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

/**
 * Derive adult-facing content signals. Signals describe concepts/items and
 * instructional pacing—not learner ability, rank, or permanent placement.
 */
export function deriveInstructionalInsights({
  evidence = [], learnerIds = [], expectations = [], scope, asOf,
  accuracyThresholdPercent = 70, minimumResponses = 2,
  recommendationPolicy,
} = {}) {
  if (!Array.isArray(learnerIds) || learnerIds.length === 0 || new Set(learnerIds).size !== learnerIds.length) {
    throw new TypeError('learnerIds must contain unique learner IDs');
  }
  if (!isCanonicalTimestamp(asOf)) throw new TypeError('asOf must be a canonical ISO-8601 timestamp');
  if (!isObject(scope) || !isText(scope.type) || !isText(scope.id)) {
    throw new TypeError('scope requires non-empty type and id');
  }
  const recommendation = normalizeRecommendationPolicy(recommendationPolicy, asOf);
  integerRange(accuracyThresholdPercent, 0, 100, 'accuracyThresholdPercent');
  integerRange(minimumResponses, 1, 1000, 'minimumResponses');
  const learnerSet = new Set(learnerIds);
  const rows = evidence.map((entry, index) => {
    const result = validateLearningEvidence(entry, { path: `evidence[${index}]` });
    if (result.errors.length) throw new TypeError(result.errors.join('; '));
    return result.evidence;
  }).filter((entry) => learnerSet.has(entry.learnerId));
  const normalizedExpectations = expectations.map((entry, index) => {
    const result = validateLearningExpectation(entry, { path: `expectations[${index}]` });
    if (result.errors.length) throw new TypeError(result.errors.join('; '));
    return result.expectation;
  });
  const assessed = rows.filter((entry) => entry.activity.graded && entry.measures.responses > 0);
  const concepts = aggregateTargets(assessed, (entry) => entry.learning.conceptIds, {
    kind: 'concept', accuracyThresholdPercent, minimumResponses,
    scope, generatedAt: asOf, recommendation,
  });
  const items = aggregateTargets(assessed, (entry) => (
    entry.activity.itemId ? [entry.activity.itemId] : []
  ), {
    kind: 'item', accuracyThresholdPercent, minimumResponses,
    scope, generatedAt: asOf, recommendation,
  });
  const pacing = normalizedExpectations.map((expectation) => pacingView({
    expectation, evidence: rows, learnerIds, asOf, scope, recommendation,
  })).sort((left, right) => left.dueAt.localeCompare(right.dueAt)
    || left.expectationId.localeCompare(right.expectationId));
  return Object.freeze({
    schema: INSTRUCTIONAL_INSIGHTS_SCHEMA,
    generatedAt: asOf,
    scope: Object.freeze({ type: String(scope.type), id: String(scope.id) }),
    policy: Object.freeze({
      accuracyThresholdPercent,
      minimumResponses,
      recommendationVersion: recommendation.version,
      recommendationExpiresAt: recommendation.expiresAt,
    }),
    summary: Object.freeze({
      learnerCount: learnerIds.length,
      evidenceCount: rows.length,
      assessedResponseCount: assessed.reduce((sum, entry) => sum + entry.measures.responses, 0),
      conceptCount: concepts.length,
      conceptsNeedingInstructionalReview: concepts.filter(({ signal }) => signal === 'review_instruction').length,
      pacingExpectationCount: pacing.length,
      pacingReviewCount: pacing.filter(({ status }) => status === 'review_pacing').length,
    }),
    concepts,
    items,
    pacing: Object.freeze(pacing),
    constraints: Object.freeze({
      learnerRanking: false,
      permanentAbilityLabels: false,
      pacingRequiresAuthoredExpectations: true,
    }),
  });
}

function aggregateTargets(entries, getIds, {
  kind, accuracyThresholdPercent, minimumResponses, scope, generatedAt, recommendation,
}) {
  const grouped = new Map();
  for (const entry of entries) {
    for (const id of [...new Set(getIds(entry))]) {
      const current = grouped.get(id) ?? {
        id, responses: 0, correct: 0, evidenceCount: 0,
        learners: new Set(), affectedLearners: new Set(),
        firstActivityAt: null, lastActivityAt: null,
      };
      current.responses += entry.measures.responses;
      current.correct += entry.measures.correct;
      current.evidenceCount += 1;
      current.learners.add(entry.learnerId);
      if (entry.measures.correct < entry.measures.responses) current.affectedLearners.add(entry.learnerId);
      if (current.firstActivityAt === null || entry.occurredAt < current.firstActivityAt) {
        current.firstActivityAt = entry.occurredAt;
      }
      if (current.lastActivityAt === null || entry.occurredAt > current.lastActivityAt) {
        current.lastActivityAt = entry.occurredAt;
      }
      grouped.set(id, current);
    }
  }
  return Object.freeze([...grouped.values()].map((entry) => {
    const accuracyPercent = Math.round((entry.correct / entry.responses) * 100);
    const signal = entry.responses < minimumResponses ? 'limited_evidence'
      : accuracyPercent < accuracyThresholdPercent ? 'review_instruction' : 'monitor';
    return Object.freeze({
      target: Object.freeze({ kind, id: entry.id }),
      signal,
      evidenceCount: entry.evidenceCount,
      responseCount: entry.responses,
      correctCount: entry.correct,
      incorrectCount: entry.responses - entry.correct,
      accuracyPercent,
      learnerCount: entry.learners.size,
      affectedLearnerCount: entry.affectedLearners.size,
      affectedLearnerIds: Object.freeze([...entry.affectedLearners].sort()),
      firstActivityAt: entry.firstActivityAt,
      lastActivityAt: entry.lastActivityAt,
      ...(signal === 'review_instruction' ? {
        suggestedAction: Object.freeze({
          kind: 'review_instruction',
          target: Object.freeze({ kind, id: entry.id }),
          recommendation: createLearningRecommendation({
            recommendationId: `instruction:${kind}:${entry.id}`,
            audience: 'adult', scope, target: { kind, id: entry.id },
            actionKind: 'review_instruction',
            basis: {
              kind: 'evidence_aggregate', evidenceCount: entry.evidenceCount,
              responseCount: entry.responses, correctCount: entry.correct,
              learnerCount: entry.learners.size,
              firstEvidenceAt: entry.firstActivityAt,
              lastEvidenceAt: entry.lastActivityAt,
            },
            policyVersion: recommendation.version,
            generatedAt,
            expiresAt: recommendation.expiresAt,
          }),
        }),
      } : {}),
    });
  }).sort((left, right) => SIGNAL_ORDER[left.signal] - SIGNAL_ORDER[right.signal]
    || left.accuracyPercent - right.accuracyPercent
    || right.responseCount - left.responseCount
    || left.target.id.localeCompare(right.target.id)));
}

function pacingView({ expectation, evidence, learnerIds, asOf, scope, recommendation }) {
  const field = TARGET_FIELD[expectation.target.kind];
  const completed = new Set(evidence
    .filter((entry) => entry.learning[field] === expectation.target.id && entry.measures.completions > 0)
    .map((entry) => entry.learnerId));
  const completedPercent = Math.round((completed.size / learnerIds.length) * 100);
  const status = completedPercent >= expectation.expectedCompletedPercent
    ? 'met'
    : asOf < expectation.dueAt ? 'upcoming' : 'review_pacing';
  return Object.freeze({
    expectationId: expectation.expectationId,
    target: expectation.target,
    dueAt: expectation.dueAt,
    expectedCompletedPercent: expectation.expectedCompletedPercent,
    completedLearnerCount: completed.size,
    learnerCount: learnerIds.length,
    completedPercent,
    status,
    ...(status === 'review_pacing' ? {
      suggestedAction: Object.freeze({
        kind: 'review_pacing', target: expectation.target,
        recommendation: createLearningRecommendation({
          recommendationId: `pacing:${expectation.expectationId}`,
          audience: 'adult', scope, target: expectation.target,
          actionKind: 'review_pacing',
          basis: {
            kind: 'authored_expectation', expectationId: expectation.expectationId,
            dueAt: expectation.dueAt,
            expectedCompletedPercent: expectation.expectedCompletedPercent,
            completedLearnerCount: completed.size,
            learnerCount: learnerIds.length,
          },
          policyVersion: recommendation.version,
          generatedAt: asOf,
          expiresAt: recommendation.expiresAt,
        }),
      }),
    } : {}),
  });
}

function normalizeRecommendationPolicy(raw, asOf) {
  if (!isObject(raw) || !isText(raw.version) || !isCanonicalTimestamp(raw.expiresAt)
      || raw.expiresAt <= asOf) {
    throw new TypeError('recommendationPolicy requires a version and future canonical expiresAt');
  }
  return Object.freeze({ version: String(raw.version), expiresAt: raw.expiresAt });
}

function integerRange(value, minimum, maximum, name) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}
