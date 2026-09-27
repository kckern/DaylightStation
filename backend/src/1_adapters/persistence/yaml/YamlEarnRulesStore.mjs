/**
 * The household earn rules at `<household>/economy/earn-rules.yml`, with every
 * superseded revision archived at `<household>/economy/earn-rules.history/NNNN.yml`.
 *
 * Read fresh on every call (a rate edit from the teacher console must take
 * effect without a restart — unlike the startup-cached `economy` app config).
 * Missing reads as null (the service falls back to its built-in defaults); a
 * CORRUPT file throws, because quietly pricing a week at the defaults when the
 * household had set its own rates would be a wrong answer that looks right.
 */
import path from 'path';
import yaml from 'js-yaml';
import { fileExists, readFile, saveYamlToPathAtomic, listEntries } from '#system/utils/FileIO.mjs';
import { IEarnRulesStore } from '#apps/economy/ports/IEarnRulesStore.mjs';

const FILE = 'economy/earn-rules.yml';
const HISTORY = 'economy/earn-rules.history';

export class YamlEarnRulesStore extends IEarnRulesStore {
  #configService;
  #logger;
  #writeChain = Promise.resolve();

  constructor({ configService, logger = console } = {}) {
    super();
    if (!configService?.getHouseholdPath) throw new Error('YamlEarnRulesStore requires configService');
    this.#configService = configService;
    this.#logger = logger;
  }

  #path(rel) {
    return this.#configService.getHouseholdPath(rel);
  }

  #load(file) {
    if (!fileExists(file)) return null;
    const text = readFile(file);
    if (typeof text !== 'string' || !text.trim()) return null;
    try {
      return yaml.load(text) ?? null;
    } catch (err) {
      this.#logger.error?.('economy.earn-rules.corrupt', { file, error: err.message });
      throw new Error(`earn-rules file is unreadable (${file}): ${err.message}`);
    }
  }

  async read() {
    return this.#load(this.#path(FILE));
  }

  async write(doc, { previous = null } = {}) {
    // Serialized: two quick edits must archive and replace in order.
    const run = this.#writeChain.then(() => {
      if (previous && Number.isInteger(previous.revision) && previous.revision > 0) {
        const name = String(previous.revision).padStart(4, '0');
        saveYamlToPathAtomic(path.join(this.#path(HISTORY), `${name}.yml`), previous);
      }
      saveYamlToPathAtomic(this.#path(FILE), doc);
    });
    this.#writeChain = run.catch(() => {});
    return run;
  }

  async history() {
    const dir = this.#path(HISTORY);
    let names = [];
    try { names = listEntries(dir) ?? []; } catch { return []; }
    return names
      .filter((n) => /^\d{4,}\.yml$/.test(n))
      .sort()
      .reverse()
      .map((n) => this.#load(path.join(dir, n)))
      .filter(Boolean);
  }
}

export default YamlEarnRulesStore;
