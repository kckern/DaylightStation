import { ILearningCatalogAccessPolicy } from '#apps/school/ports/ILearningCatalogAccessPolicy.mjs';

const ADDRESS_PREFIX = /^[a-z0-9][a-z0-9-]{0,63}(\/[a-z0-9][a-z0-9-]{0,63}){0,4}$/;

/** Translate parent-authored School assignments plus school.yml overrides. */
export class AssignedLearningCatalogAccessPolicy extends ILearningCatalogAccessPolicy {
  #assignments; #policy;

  constructor({ assignments, config = null } = {}) {
    super();
    if (!assignments || typeof assignments.get !== 'function') {
      throw new Error('AssignedLearningCatalogAccessPolicy requires assignments');
    }
    this.#assignments = assignments;
    this.#policy = normalizePolicy(config);
  }

  async resolve({ learners = [], lessons = [] } = {}) {
    validateQuery({ learners, lessons });
    const knownAddresses = new Set(lessons.map(({ address }) => address));
    const resolved = await Promise.all(learners.map(async ({ learnerId }) => {
      const assignment = await this.#assignments.get(learnerId);
      const courseIds = assignmentIds(assignment?.courses, 'courseId');
      const unitIds = assignmentIds(assignment?.units, 'unitId');
      const override = this.#policy.learners[learnerId] ?? emptyRule();
      const lessonAddresses = lessons.filter((lesson) => {
        const assigned = courseIds.has(lesson.context.courseId)
          || unitIds.has(lesson.context.unitId);
        const baseline = assignment ? assigned : this.#policy.unassigned === 'visible';
        return applyRule(baseline, lesson.address, override);
      }).map(({ address }) => address);
      return { learnerId, lessonAddresses };
    }));
    const guestRule = this.#policy.guest;
    const guestAddresses = lessons.filter(({ address }) => applyRule(
      guestRule.mode === 'all', address, guestRule,
    )).map(({ address }) => address);
    assertKnownAddresses(resolved.flatMap(({ lessonAddresses }) => lessonAddresses), knownAddresses);
    assertKnownAddresses(guestAddresses, knownAddresses);
    return {
      learners: resolved,
      guest: { lessonAddresses: guestAddresses },
    };
  }
}

function normalizePolicy(raw) {
  if (raw === undefined || raw === null) {
    return Object.freeze({ unassigned: 'hidden', guest: emptyRule(), learners: Object.freeze({}) });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('catalog.access must be a mapping');
  }
  const unassigned = raw.unassigned ?? 'hidden';
  if (!['hidden', 'visible'].includes(unassigned)) {
    throw new Error('catalog.access.unassigned must be hidden|visible');
  }
  const learners = raw.learners ?? {};
  if (!learners || typeof learners !== 'object' || Array.isArray(learners)) {
    throw new Error('catalog.access.learners must be a mapping');
  }
  return Object.freeze({
    unassigned,
    guest: normalizeRule(raw.guest ?? 'none', 'catalog.access.guest'),
    learners: Object.freeze(Object.fromEntries(Object.entries(learners).map(([learnerId, rule]) => {
      if (typeof learnerId !== 'string' || !learnerId) {
        throw new Error('catalog.access.learners contains an empty learner ID');
      }
      return [learnerId, normalizeRule(rule, `catalog.access.learners.${learnerId}`)];
    }))),
  });
}

function normalizeRule(raw, path = 'catalog access rule') {
  if (raw === 'all' || raw === 'none') {
    return Object.freeze({ mode: raw, include: Object.freeze([]), exclude: Object.freeze([]) });
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${path} must be all|none or a mapping`);
  }
  const mode = raw.mode ?? 'inherit';
  if (!['inherit', 'all', 'none'].includes(mode)) throw new Error(`${path}.mode must be inherit|all|none`);
  return Object.freeze({
    mode,
    include: Object.freeze(prefixes(raw.include, `${path}.include`)),
    exclude: Object.freeze(prefixes(raw.exclude, `${path}.exclude`)),
  });
}

function prefixes(raw, path) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string' || !ADDRESS_PREFIX.test(value))
      || new Set(raw).size !== raw.length) {
    throw new Error(`${path} must contain unique canonical Catalog address prefixes`);
  }
  return [...raw];
}

function applyRule(inherited, address, rule) {
  let available = rule.mode === 'all' ? true : rule.mode === 'none' ? false : inherited;
  if (rule.include.some((prefix) => matchesPrefix(address, prefix))) available = true;
  if (rule.exclude.some((prefix) => matchesPrefix(address, prefix))) available = false;
  return available;
}

function matchesPrefix(address, prefix) {
  return address === prefix || address.startsWith(`${prefix}/`);
}

function assignmentIds(raw, field) {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map((entry) => (typeof entry === 'string' ? entry : entry?.[field]))
    .filter((value) => typeof value === 'string' && value));
}

function emptyRule() {
  return Object.freeze({ mode: 'inherit', include: Object.freeze([]), exclude: Object.freeze([]) });
}

function validateQuery({ learners, lessons }) {
  if (!Array.isArray(learners) || learners.some(({ learnerId }) => typeof learnerId !== 'string' || !learnerId)
      || new Set(learners.map(({ learnerId }) => learnerId)).size !== learners.length) {
    throw new Error('Learning Catalog access requires unique learners');
  }
  if (!Array.isArray(lessons) || lessons.some(({ address, context }) => (
    typeof address !== 'string' || !ADDRESS_PREFIX.test(address)
    || address.split('/').length !== 5 || !context?.courseId || !context?.unitId
  )) || new Set(lessons.map(({ address }) => address)).size !== lessons.length) {
    throw new Error('Learning Catalog access requires unique canonical lessons');
  }
}

function assertKnownAddresses(addresses, known) {
  if (addresses.some((address) => !known.has(address))) {
    throw new Error('Learning Catalog access returned an unknown lesson');
  }
}

export default AssignedLearningCatalogAccessPolicy;
