import { IStateGatesTransitionRepository } from '#apps/state-gates/ports/IStateGatesTransitionRepository.mjs';

export class YamlStateGatesTransitionRepository extends IStateGatesTransitionRepository {
  #engine;
  constructor({ engine }) { super(); this.#engine = engine; }
  async replayAfter(householdId, revision, limit) {
    const page = await this.#engine.replayAfter(householdId, revision, limit);
    return { ...page, events: page.events.map(event => ({ schema: 'daylight.state-gates-event/v1', ...event })) };
  }
  async oldestAvailableRevision(householdId) { return this.#engine.oldestAvailableRevision(householdId); }
  async pending(householdId) { return this.#engine.pending(householdId); }
  async markPublished(householdId, ids) { return this.#engine.markPublished(householdId, ids); }
  async compactThrough(householdId, revision) { return this.#engine.compactThrough(householdId, revision); }
}
export default YamlStateGatesTransitionRepository;
