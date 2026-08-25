/** Durable Fitness-owned record of one School work-session attempt. */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import yaml from 'js-yaml';

const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;
const dump = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

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
      const record = yaml.load(await fs.readFile(this.#file(workSessionId, householdId), 'utf8'));
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
      const root = this.#root(householdId);
      await fs.mkdir(root, { recursive: true });
      const file = this.#file(id, householdId);
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temp, dump(stored), { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temp, file);
      return stored;
    });
    this.#writeChain = queued.catch(() => {});
    return queued;
  }
}

export default YamlFitnessSchoolAttemptStore;

