const AGENT_ID = 'concierge';
const USER_ID = 'household';

/** Household concierge memory operations over the application memory repository. */
export class ConciergeMemoryService {
  constructor({ workingMemory }) {
    if (!workingMemory?.load || !workingMemory?.save) {
      throw new Error('ConciergeMemoryService requires workingMemory');
    }
    this.workingMemory = workingMemory;
  }

  async get(key) {
    const state = await this.workingMemory.load(AGENT_ID, USER_ID);
    return state.get(key) ?? null;
  }

  async set(key, value) {
    const state = await this.workingMemory.load(AGENT_ID, USER_ID);
    state.set(key, value);
    await this.workingMemory.save(AGENT_ID, USER_ID, state);
  }

  async merge(key, partial) {
    const state = await this.workingMemory.load(AGENT_ID, USER_ID);
    const current = state.get(key);
    state.set(key, current && typeof current === 'object' && !Array.isArray(current)
      ? { ...current, ...partial }
      : partial);
    await this.workingMemory.save(AGENT_ID, USER_ID, state);
  }

  async delete(key) {
    const state = await this.workingMemory.load(AGENT_ID, USER_ID);
    if (state.get(key) === undefined) return false;
    state.remove(key);
    await this.workingMemory.save(AGENT_ID, USER_ID, state);
    return true;
  }
}
