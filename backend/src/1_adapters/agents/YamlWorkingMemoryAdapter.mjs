// backend/src/1_adapters/agents/YamlWorkingMemoryAdapter.mjs

import { WorkingMemoryState } from '#apps/agents/framework/WorkingMemory.mjs';

export class YamlWorkingMemoryAdapter {
  #dataService;
  #logger;

  constructor({ dataService, logger = console }) {
    if (!dataService) {
      throw new Error('dataService is required');
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  async load(agentId, userId) {
    const relativePath = `agents/${agentId}/working-memory`;
    const data = this.#dataService.user.read(relativePath, userId);

    if (!data) {
      this.#logger.info?.('workingMemory.load.empty', { agentId, userId });
      return new WorkingMemoryState();
    }

    const state = WorkingMemoryState.fromJSON(data);
    state.pruneExpired();

    this.#logger.info?.('workingMemory.load.ok', {
      agentId, userId,
      entryCount: Object.keys(state.getAll()).length,
    });

    return state;
  }

  async save(agentId, userId, state) {
    const relativePath = `agents/${agentId}/working-memory`;
    const data = state.toJSON();

    this.#dataService.user.write(relativePath, data, userId);

    this.#logger.info?.('workingMemory.save.ok', {
      agentId, userId,
      entryCount: Object.keys(data).length,
    });
  }
}
