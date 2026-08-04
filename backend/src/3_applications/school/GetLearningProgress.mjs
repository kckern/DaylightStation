import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';
import { aggregateLearningProgress } from '#domains/school/progress/index.mjs';
import { listSchoolLearningEvidence } from './schoolLearningEvidence.mjs';

/**
 * Cross-surface School progress query. Membership/calendar policy and evidence
 * I/O sit behind ports; all filtering and aggregation remains in the domain.
 */
export class GetLearningProgress {
  #evidenceSources; #cohorts; #periods; #followUps; #clock; #logger;

  constructor({
    evidenceSources = [], cohortDirectory, academicPeriods = null,
    followUpSources = [], clock = () => new Date(), logger = console,
  } = {}) {
    if (!cohortDirectory || !Array.isArray(evidenceSources) || evidenceSources.length === 0) {
      throw new Error('GetLearningProgress requires a cohort directory and at least one evidence source');
    }
    this.#evidenceSources = evidenceSources.filter(Boolean);
    this.#cohorts = cohortDirectory;
    this.#periods = academicPeriods;
    this.#followUps = followUpSources.filter(Boolean);
    this.#clock = clock;
    this.#logger = logger;
  }

  async execute({
    scopeType = 'household', scopeId = 'household', periodId = null,
    from = null, to = null, filters = {}, groupBy = [], recentLimit = 10,
    followUpContext = {},
  } = {}) {
    const scope = await this.#cohorts.resolveScope({ type: scopeType, id: scopeId });
    if (!scope) throw new EntityNotFoundError('School progress scope', `${scopeType}:${scopeId}`);
    const period = periodId === null ? null : await this.#periods?.getPeriod(periodId);
    if (periodId !== null && !period) throw new EntityNotFoundError('Academic period', periodId);
    const window = { from, to, ...(period ? { period } : {}) };
    const evidenceQuery = {
      learnerIds: [...scope.learnerIds],
      from: from ?? period?.startsAt ?? null,
      to: to ?? period?.endsAt ?? null,
    };
    const evidence = await listSchoolLearningEvidence({
      sources: this.#evidenceSources, query: evidenceQuery, logger: this.#logger,
    });
    const actionQuery = { scope, window: evidenceQuery, filters, evidence, deliveryContext: followUpContext };
    const followUps = (await Promise.all(this.#followUps.map(async (source) => {
      try {
        const actions = await source.listFollowUps(actionQuery);
        return Array.isArray(actions) ? actions : [];
      } catch (error) {
        // Follow-up advice is optional enrichment. A broken advisor must not
        // hide durable scores/progress from the learner or parent.
        this.#logger.error?.('school.progress.follow-up-source-failed', { error: error.message });
        return [];
      }
    }))).flat();
    const generatedAt = readClock(this.#clock);
    try {
      return aggregateLearningProgress({
        evidence, scope, window, filters, groupBy, followUps, generatedAt, recentLimit,
      });
    } catch (error) {
      if (error instanceof TypeError) throw new ValidationError(error.message);
      throw error;
    }
  }

  async options() {
    return {
      learners: await this.#cohorts.listLearners(),
      scopes: await this.#cohorts.listScopes(),
      periods: this.#periods ? await this.#periods.listPeriods() : [],
    };
  }
}

function readClock(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new Error('School progress clock must return a valid Date');
  }
  return value.toISOString();
}

export default GetLearningProgress;
