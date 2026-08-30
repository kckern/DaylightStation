import { IRequirementsTransitionRepository } from '#apps/requirements/ports/IRequirementsTransitionRepository.mjs';

export class YamlRequirementsTransitionRepository extends IRequirementsTransitionRepository {
  #engine;
  constructor({ engine }) { super(); this.#engine = engine; }
  async replayAfter(householdId, revision, limit) {
    const page = await this.#engine.replayAfter(householdId, revision, limit);
    return { ...page, events: page.events.map(event => ({ schema: 'daylight.requirements-event/v1', ...event })) };
  }
  async oldestAvailableRevision(householdId) { return this.#engine.oldestAvailableRevision(householdId); }
  async pending(householdId) { return this.#engine.pending(householdId); }
  async markPublished(householdId, ids) { return this.#engine.markPublished(householdId, ids); }
  async compactThrough(householdId, revision) { return this.#engine.compactThrough(householdId, revision); }
}
export default YamlRequirementsTransitionRepository;
