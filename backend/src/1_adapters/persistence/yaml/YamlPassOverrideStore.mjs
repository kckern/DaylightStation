/**
 * YamlPassOverrideStore — mid-period pass-criteria overrides (plan W3-2):
 * `apps/school/pass-overrides.yml` `{overrides: {unitId: percent}, history}`.
 * The one consumer is `CloseSessionOutcome` (effective passing percent =
 * override ?? the unit's authored `passing.percent`); authored curriculum
 * stays untouched — an override is data, reversible, and audited.
 */
import path from 'path';
import fsSync from 'fs';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

export class YamlPassOverrideStore {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlPassOverrideStore requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return path.join(this.#configService.getHouseholdPath('apps/school'), 'pass-overrides.yml'); }

  #read() {
    try {
      const raw = yaml.load(fsSync.readFileSync(this.#file(), 'utf8'));
      return raw && typeof raw === 'object' ? { overrides: raw.overrides ?? {}, history: raw.history ?? [] } : { overrides: {}, history: [] };
    } catch { return { overrides: {}, history: [] }; }
  }

  all() { return { ...this.#read().overrides }; }

  percentFor(unitId) {
    const value = this.#read().overrides[unitId];
    return Number.isInteger(value) ? value : null;
  }

  async set(unitId, percent, { editedBy = null, at = new Date().toISOString() } = {}) {
    this.#writeChain = this.#writeChain.then(async () => {
      const current = this.#read();
      const overrides = { ...current.overrides };
      if (percent === null) delete overrides[unitId];
      else overrides[unitId] = percent;
      const history = [...current.history, { at, editedBy, unitId, percent }];
      await fs.mkdir(path.dirname(this.#file()), { recursive: true });
      await fs.writeFile(this.#file(), dumpYaml({ overrides, history }), 'utf8');
      this.#logger.info?.('school.pass-override.set', { unitId, percent, editedBy });
    });
    await this.#writeChain;
  }
}

export default YamlPassOverrideStore;
