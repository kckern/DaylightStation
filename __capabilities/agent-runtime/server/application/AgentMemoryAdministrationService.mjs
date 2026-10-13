/** Agent-aware working-memory reads and deletion commands. */
export class AgentMemoryAdministrationService {
  constructor({ orchestrator, workingMemory, createEmptyState } = {}) {
    this.orchestrator = orchestrator;
    this.workingMemory = workingMemory;
    this.createEmptyState = createEmptyState;
  }

  exists(agentId) { return this.orchestrator.has(agentId); }
  async read(agentId, userId) {
    if (!this.exists(agentId)) return { kind: 'agent_not_found' };
    const state = await this.workingMemory.load(agentId, userId);
    return { kind: 'found', entries: state.toJSON() };
  }
  async clear(agentId, userId) {
    if (!this.exists(agentId)) return { kind: 'agent_not_found' };
    await this.workingMemory.save(agentId, userId, this.createEmptyState());
    return { kind: 'cleared' };
  }
  async remove(agentId, userId, key) {
    if (!this.exists(agentId)) return { kind: 'agent_not_found' };
    const state = await this.workingMemory.load(agentId, userId);
    const deleted = state.get(key) !== undefined;
    state.remove(key);
    await this.workingMemory.save(agentId, userId, state);
    return { kind: 'removed', deleted };
  }
}

export default AgentMemoryAdministrationService;
