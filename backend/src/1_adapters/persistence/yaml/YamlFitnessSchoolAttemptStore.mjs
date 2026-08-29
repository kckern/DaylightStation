/** Durable Fitness-owned record of one School work-session attempt. */
import path from 'node:path';
import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
export class YamlFitnessSchoolAttemptStore {
  #config; #logger; #writeChain = Promise.resolve();
  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlFitnessSchoolAttemptStore requires configService');
    this.#config = configService;
    this.#logger = logger;
  }
  #root(householdId) { return this.#config.getHouseholdPath('fitness/school-attempts', householdId); }
  #file(id, householdId) { return path.join(this.#root(householdId), `${id}.yml`); }

  async get(workSessionId, householdId = null) {
    if (!SAFE_ID.test(workSessionId ?? '')) return null;
    try {
      const record = readYamlFromPath(this.#file(workSessionId, householdId));
      return record?.schema === 'fitness.school-attempt/v1' ? record : null;
    } catch (error) {
      if (error?.code !== 'ENOENT') this.#logger.warn?.('fitness.school-attempt.read-failed', { workSessionId, error: error.message });
      return null;
    }
  }

  async put(record, householdId = null) {
    const id = record?.workSessionId;
    if (!SAFE_ID.test(id ?? '')) throw new Error(`unsafe School work-session id: ${id}`);
    const stored = structuredClone(record);
    const queued = this.#writeChain.then(async () => {
      saveYamlToPathAtomic(this.#file(id, householdId), stored, { indent: 2, lineWidth: -1, noRefs: true });
      return stored;
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }
}

export default YamlFitnessSchoolAttemptStore;
