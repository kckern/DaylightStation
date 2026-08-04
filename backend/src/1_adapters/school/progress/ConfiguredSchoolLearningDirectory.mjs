import { ISchoolCohortDirectory } from '#apps/school/ports/ISchoolCohortDirectory.mjs';
import { IAcademicPeriodSource } from '#apps/school/ports/IAcademicPeriodSource.mjs';
import { validateAcademicPeriod } from '#domains/school/progress/index.mjs';

/**
 * Translate household profiles plus school.yml policy into the learner roster,
 * cohorts, and academic calendar used by every School surface.
 */
export class ConfiguredSchoolLearningDirectory extends ISchoolCohortDirectory {
  #userService; #config; #householdId; #clock; #logger;

  constructor({ userService, config = {}, householdId = null, clock = () => new Date(), logger = console } = {}) {
    super();
    if (!userService || typeof userService.getHouseholdRoster !== 'function') {
      throw new Error('ConfiguredSchoolLearningDirectory requires userService');
    }
    this.#userService = userService;
    this.#config = config ?? {};
    this.#householdId = householdId;
    this.#clock = clock;
    this.#logger = logger;
  }

  listLearners() {
    const household = this.#userService.getHouseholdRoster(this.#householdId) ?? [];
    const configured = configuredLearnerIds(this.#config);
    if (configured !== null) {
      const allow = new Set(configured);
      const learners = household.filter((profile) => allow.has(profile.id));
      const missing = configured.filter((id) => !learners.some((profile) => profile.id === id));
      if (missing.length) this.#logger.warn?.('school.learners.configured-profile-missing', { learnerIds: missing });
      return learners.map(projectLearner);
    }
    const year = this.#clock().getFullYear();
    return household
      .filter((profile) => Number.isInteger(profile.birthyear) && year - profile.birthyear < 18)
      .map(projectLearner);
  }

  hasLearner(learnerId) { return this.listLearners().some((profile) => profile.id === learnerId); }

  listScopes() {
    const learners = this.listLearners();
    return [
      { type: 'household', id: this.#householdId ?? 'household', label: 'Household', learnerIds: learners.map(({ id }) => id) },
      ...configuredCohorts(this.#config, learners),
    ];
  }

  resolveScope({ type = 'household', id = null } = {}) {
    const learners = this.listLearners();
    if (type === 'learner') {
      const learner = learners.find((entry) => entry.id === id);
      return learner ? { type, id: learner.id, label: learner.name, learnerIds: [learner.id] } : null;
    }
    if (type === 'household') {
      const householdScope = this.listScopes()[0];
      if (id !== null && id !== 'household' && id !== householdScope.id) return null;
      return householdScope;
    }
    return this.listScopes().find((scope) => scope.type === type && scope.id === id) ?? null;
  }
}

export class ConfiguredAcademicPeriodSource extends IAcademicPeriodSource {
  #periods;

  constructor({ config = {} } = {}) {
    super();
    const raw = config.progress?.academicPeriods ?? config.academicPeriods ?? [];
    if (!Array.isArray(raw)) throw new Error('school academicPeriods must be an array');
    const seen = new Set();
    this.#periods = raw.map((entry, index) => {
      const candidate = { schema: 'school.academic-period/v1', ...entry };
      const result = validateAcademicPeriod(candidate, { path: `academicPeriods[${index}]` });
      if (result.errors.length) throw new Error(result.errors.join('; '));
      if (seen.has(result.period.periodId)) throw new Error(`academicPeriods[${index}]: duplicate periodId '${result.period.periodId}'`);
      seen.add(result.period.periodId);
      return result.period;
    });
  }

  listPeriods() { return structuredClone(this.#periods); }
  getPeriod(periodId) { return structuredClone(this.#periods.find((period) => period.periodId === periodId) ?? null); }
}

function configuredLearnerIds(config) {
  const raw = config.learners;
  if (raw === undefined || raw === null) return null;
  const ids = Array.isArray(raw) ? raw : raw?.include;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) {
    throw new Error('school learners must be an array or { include: string[] }');
  }
  if (new Set(ids).size !== ids.length) throw new Error('school learners must not contain duplicates');
  return ids;
}

function configuredCohorts(config, learners) {
  const raw = config.progress?.cohorts ?? config.cohorts ?? [];
  if (!Array.isArray(raw)) throw new Error('school progress cohorts must be an array');
  const learnerIds = new Set(learners.map(({ id }) => id));
  const keys = new Set();
  return raw.map((cohort, index) => {
    if (!cohort || typeof cohort !== 'object' || Array.isArray(cohort)
        || !cohort.type || !cohort.id || !cohort.label || !Array.isArray(cohort.learnerIds)
        || cohort.learnerIds.length === 0) {
      throw new Error(`school progress cohorts[${index}] is invalid`);
    }
    const key = `${cohort.type}:${cohort.id}`;
    if (keys.has(key)) throw new Error(`school progress cohorts[${index}] duplicates '${key}'`);
    keys.add(key);
    const unknown = cohort.learnerIds.filter((id) => !learnerIds.has(id));
    if (unknown.length) throw new Error(`school progress cohorts[${index}] contains non-learner members: ${unknown.join(', ')}`);
    return {
      type: String(cohort.type), id: String(cohort.id), label: String(cohort.label),
      learnerIds: [...new Set(cohort.learnerIds)],
    };
  });
}

function projectLearner(profile) {
  return {
    id: profile.id, name: profile.name,
    ...(profile.group_label ? { groupLabel: profile.group_label } : {}),
    ...(Number.isInteger(profile.birthyear) ? { birthyear: profile.birthyear } : {}),
  };
}

export default ConfiguredSchoolLearningDirectory;

