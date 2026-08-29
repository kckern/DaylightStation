/** Last-known-good compiled School projection for Fitness-owned source data. */
import path from 'node:path';
import { readYamlFromPath, saveYamlToPathAtomic } from '#system/utils/FileIO.mjs';

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
export class YamlFitnessCourseProjectionStore {
  #config; #logger;
  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlFitnessCourseProjectionStore requires configService');
    this.#config = configService;
    this.#logger = logger;
  }
  #root() { return this.#config.getHouseholdPath('school/runtime/fitness-course-projections'); }
  #file(work) { return path.join(this.#root(), `${work}.yml`); }

  async get(work) {
    if (!SAFE_ID.test(work ?? '')) return null;
    try {
      const value = readYamlFromPath(this.#file(work));
      return value?.schema === 'school.fitness-course-projection/v1' ? value : null;
    } catch (error) {
      if (error?.code !== 'ENOENT') this.#logger.warn?.('school.fitness-course.snapshot-read-failed', { work, error: error.message });
      return null;
    }
  }

  async put(work, projection) {
    if (!SAFE_ID.test(work ?? '')) throw new Error(`unsafe Fitness course id: ${work}`);
    const record = {
      schema: 'school.fitness-course-projection/v1',
      compiledAt: new Date().toISOString(),
      ...structuredClone(projection),
    };
    saveYamlToPathAtomic(this.#file(work), record, { indent: 2, lineWidth: -1, noRefs: true });
    return record;
  }
}

export default YamlFitnessCourseProjectionStore;
