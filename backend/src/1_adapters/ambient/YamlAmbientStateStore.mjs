// backend/src/1_adapters/ambient/YamlAmbientStateStore.mjs
// Persists ambient scheduler state to data/system/state/ambient-runtime.yml.
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Write failures are non-fatal (warn-only). Callers should monitor the
 * `ambient.state.write_failed` log event for persistent write errors.
 */
export class YamlAmbientStateStore {
  #file; #logger;

  constructor({ dataDir, logger = console }) {
    this.#file = path.join(dataDir, 'system', 'state', 'ambient-runtime.yml');
    this.#logger = logger;
  }

  async load() {
    try {
      const doc = yaml.load(await fs.readFile(this.#file, 'utf8')) || {};
      return { owned: doc.owned ?? null, handled: doc.handled || {} };
    } catch (err) {
      if (err.code !== 'ENOENT') this.#logger.warn?.('ambient.state.read_failed', { error: err.message });
      return { owned: null, handled: {} };
    }
  }

  async save(state) {
    try {
      await fs.mkdir(path.dirname(this.#file), { recursive: true });
      const body = yaml.dump(
        { owned: state.owned ?? null, handled: state.handled || {} },
        { indent: 2, lineWidth: -1, noRefs: true },
      );
      await fs.writeFile(this.#file, body, 'utf8');
    } catch (err) {
      this.#logger.warn?.('ambient.state.write_failed', { error: err.message });
    }
  }
}

export default YamlAmbientStateStore;
