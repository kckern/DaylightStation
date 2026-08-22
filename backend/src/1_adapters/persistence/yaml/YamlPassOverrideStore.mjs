/**
 * YamlPassOverrideStore — mid-period pass-criteria overrides (plan W3-2):
 * `school/plans/pass-overrides.yml` `{overrides: {unitId: percent}, history}`.
 * The one consumer is `CloseSessionOutcome` (effective passing percent =
 * override ?? the unit's authored `passing.percent`); authored curriculum
 * stays untouched — an override is data, reversible, and audited.
 */
import fsSync from 'fs';
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

async function atomicWrite(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}


export class YamlPassOverrideStore {
  #configService; #logger; #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    if (!configService?.getHouseholdPath) throw new Error('YamlPassOverrideStore requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #file() { return this.#configService.getHouseholdPath('school/plans/pass-overrides.yml'); }

  #readState() {
    let text;
    try { text = fsSync.readFileSync(this.#file(), 'utf8'); } catch { return { state: 'missing', overrides: {}, history: [] }; }
    try {
      const raw = yaml.load(text);
      if (raw && typeof raw === 'object') return { state: 'ok', overrides: raw.overrides ?? {}, history: raw.history ?? [] };
    } catch { /* fall through */ }
    this.#logger.error?.('school.pass-overrides.file-corrupt', { file: this.#file() });
    return { state: 'corrupt', overrides: {}, history: [] };
  }

  /** The edit trail, oldest first (admin advocacy #9). */
  history() { return [...this.#read().history]; }

  #read() { return this.#readState(); }

  all() { return { ...this.#read().overrides }; }

  percentFor(unitId) {
    const value = this.#read().overrides[unitId];
    return Number.isInteger(value) ? value : null;
  }

  async set(unitId, percent, { editedBy = null, at = new Date().toISOString() } = {}) {
    this.#writeChain = this.#writeChain.then(async () => {
      const current = this.#readState();
      if (current.state === 'corrupt') {
        throw new Error(`pass-overrides.yml exists but cannot be read — fix or move it before editing (${this.#file()})`);
      }
      const overrides = { ...current.overrides };
      if (percent === null) delete overrides[unitId];
      else overrides[unitId] = percent;
      const history = [...current.history, { at, editedBy, unitId, percent }];
      await atomicWrite(this.#file(), dumpYaml({ overrides, history }));
      this.#logger.info?.('school.pass-override.set', { unitId, percent, editedBy });
    });
    await this.#writeChain;
  }
}

export default YamlPassOverrideStore;
