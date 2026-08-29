// backend/src/1_adapters/agents/YamlWorkingMemoryAdapter.mjs

import { IWorkingMemoryRecordStore } from '#apps/agents/ports/IWorkingMemoryRecordStore.mjs';

export class YamlWorkingMemoryAdapter extends IWorkingMemoryRecordStore {
  #dataService;
  #logger;

  constructor({ dataService, logger = console }) {
    super();
    if (!dataService) {
      throw new Error('dataService is required');
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  async loadRecord(agentId, userId) {
    const relativePath = `agents/${agentId}/working-memory`;
    const data = this.#dataService.user.read(relativePath, userId);

    if (!data) {
      this.#logger.info?.('workingMemory.load.empty', { agentId, userId });
      return null;
    }

    this.#logger.info?.('workingMemory.load.ok', {
      agentId, userId,
      entryCount: Object.keys(data).length,
    });

    return data;
  }

  async saveRecord(agentId, userId, data) {
    const relativePath = `agents/${agentId}/working-memory`;

    this.#dataService.user.write(relativePath, data, userId);

    this.#logger.info?.('workingMemory.save.ok', {
      agentId, userId,
      entryCount: Object.keys(data).length,
    });
  }
}
