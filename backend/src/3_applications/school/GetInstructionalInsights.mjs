import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';
import { deriveInstructionalInsights } from '#domains/school/progress/index.mjs';
import { listSchoolLearningEvidence } from './schoolLearningEvidence.mjs';

/** Adult-facing content/misconception/pacing query; never ranks learners. */
export class GetInstructionalInsights {
  #sources; #cohorts; #expectations; #clock; #policy; #logger;

  constructor({
    evidenceSources = [], cohortDirectory, expectationSource = null,
    clock = () => new Date(), policy = {}, logger = null,
  } = {}) {
    if (!cohortDirectory || !Array.isArray(evidenceSources) || evidenceSources.length === 0) {
      throw new Error('GetInstructionalInsights requires cohorts and evidence sources');
    }
    this.#sources = evidenceSources.filter(Boolean);
    this.#cohorts = cohortDirectory;
    this.#expectations = expectationSource;
    this.#clock = clock;
    this.#policy = policy;
    this.#logger = logger;
  }

  async execute({ scopeType = 'household', scopeId = 'household', from = null, to = null } = {}) {
    const scope = await this.#cohorts.resolveScope({ type: scopeType, id: scopeId });
    if (!scope) throw new EntityNotFoundError('School instructional scope', `${scopeType}:${scopeId}`);
    const query = { learnerIds: [...scope.learnerIds], from, to };
    const evidence = await listSchoolLearningEvidence({ sources: this.#sources, query, logger: this.#logger });
    const expectations = this.#expectations
      ? await this.#expectations.listExpectations({ scope, from, to })
      : [];
    try {
      const generatedAt = readClock(this.#clock);
      const recommendationTtlDays = this.#policy.recommendationTtlDays ?? 7;
      if (!Number.isInteger(recommendationTtlDays)
          || recommendationTtlDays < 1 || recommendationTtlDays > 90) {
        throw new TypeError('recommendationTtlDays must be an integer from 1 to 90');
      }
      return deriveInstructionalInsights({
        evidence,
        learnerIds: scope.learnerIds,
        expectations,
        scope: { type: scope.type, id: scope.id },
        asOf: generatedAt,
        accuracyThresholdPercent: this.#policy.accuracyThresholdPercent ?? 70,
        minimumResponses: this.#policy.minimumResponses ?? 2,
        recommendationPolicy: {
          version: this.#policy.recommendationPolicyVersion
            ?? 'school.instructional-review/v1',
          expiresAt: addDays(generatedAt, recommendationTtlDays),
        },
      });
    } catch (error) {
      if (error instanceof TypeError) throw new ValidationError(error.message);
      throw error;
    }
  }
}

function addDays(timestamp, days) {
  return new Date(Date.parse(timestamp) + days * 86_400_000).toISOString();
}

function readClock(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new Error('Instructional insight clock must return a valid Date');
  }
  return value.toISOString();
}

export default GetInstructionalInsights;
