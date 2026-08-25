import path from 'node:path';
import { promises as fs } from 'node:fs';
import yaml from 'js-yaml';

const SAFE_ID = /^ral_[a-z0-9_-]{6,}$/i;
const dump = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

/** Mutable lesson-companion telemetry, intentionally separate from worksheets. */
export class YamlLessonCompanionStore {
  #configService; #logger;
  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlLessonCompanionStore requires configService');
    this.#configService = configService; this.#logger = logger;
  }
  #file(id) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error(`unsafe lesson companion id: ${id}`);
    return path.join(this.#configService.getHouseholdPath('school/records/companions'), `${id}.yml`);
  }
  async get(id) {
    try { return yaml.load(await fs.readFile(this.#file(id), 'utf8')) ?? null; } catch (error) {
      if (error?.code !== 'ENOENT') this.#logger.error?.('school.companion.unreadable', { id, error: error?.message });
      return null;
    }
  }
  async put(record) {
    const file = this.#file(record?.id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, dump(record), { encoding: 'utf8', flag: 'wx' });
    return record;
  }
  async update(id, updater) {
    const current = await this.get(id);
    if (!current) return null;
    const next = updater(structuredClone(current));
    await fs.writeFile(this.#file(id), dump(next), 'utf8');
    return next;
  }
}

export default YamlLessonCompanionStore;
