import { WorkingMemoryState } from './WorkingMemory.mjs';

/** Application repository that owns model hydration around a plain-record port. */
export class WorkingMemoryRepository {
  #recordStore;

  constructor({ recordStore }) {
    if (!recordStore?.loadRecord || !recordStore?.saveRecord) {
      throw new Error('WorkingMemoryRepository requires recordStore');
    }
    this.#recordStore = recordStore;
  }

  async load(agentId, userId) {
    const record = await this.#recordStore.loadRecord(agentId, userId);
    const state = record ? WorkingMemoryState.fromJSON(record) : new WorkingMemoryState();
    state.pruneExpired();
    return state;
  }

  async save(agentId, userId, state) {
    await this.#recordStore.saveRecord(agentId, userId, state.toJSON());
  }
}
