import { IStateGatesProjectionRepository } from '#apps/state-gates/ports/IStateGatesProjectionRepository.mjs';

export class YamlStateGatesProjectionRepository extends IStateGatesProjectionRepository {
  #engine;
  constructor({ engine }) { super(); this.#engine = engine; }
  async load(householdId) { return this.#engine.loadProjection(householdId); }
  async commitRevision(householdId, expectedRevision, nextSnapshot, transitionBatch) {
    return this.#engine.commit(householdId, expectedRevision, nextSnapshot, transitionBatch);
  }
}
export default YamlStateGatesProjectionRepository;
