import { ILearningExpectationSource } from '#apps/school/ports/ILearningExpectationSource.mjs';
import { validateLearningExpectation } from '#domains/school/progress/index.mjs';

/** Translate school.yml progress expectations into the domain contract. */
export class ConfiguredLearningExpectationSource extends ILearningExpectationSource {
  #expectations;

  constructor({ config = {} } = {}) {
    super();
    const raw = config.progress?.expectations ?? [];
    if (!Array.isArray(raw)) throw new Error('school progress.expectations must be an array');
    const ids = new Set();
    this.#expectations = raw.map((entry, index) => {
      const result = validateLearningExpectation({
        schema: 'school.learning-expectation/v1', ...entry,
      }, { path: `progress.expectations[${index}]` });
      if (result.errors.length) throw new Error(result.errors.join('; '));
      if (ids.has(result.expectation.expectationId)) {
        throw new Error(`progress.expectations[${index}]: duplicate expectationId '${result.expectation.expectationId}'`);
      }
      ids.add(result.expectation.expectationId);
      return result.expectation;
    });
  }

  listExpectations({ scope, from = null, to = null } = {}) {
    return structuredClone(this.#expectations.filter((entry) => (
      entry.scopeType === scope?.type && entry.scopeId === scope?.id
      && (from === null || entry.dueAt >= from)
      && (to === null || entry.dueAt < to)
    )));
  }
}

export default ConfiguredLearningExpectationSource;

