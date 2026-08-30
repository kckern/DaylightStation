import { IRequirementsProjectionRepository } from '#apps/requirements/ports/IRequirementsProjectionRepository.mjs';

export class YamlRequirementsProjectionRepository extends IRequirementsProjectionRepository {
  #engine;
  constructor({ engine }) { super(); this.#engine = engine; }
  async load(householdId) { return this.#engine.loadProjection(householdId); }
  async commitRevision(householdId, expectedRevision, nextSnapshot, transitionBatch) {
    return this.#engine.commit(householdId, expectedRevision, nextSnapshot, transitionBatch);
  }
}
export default YamlRequirementsProjectionRepository;
