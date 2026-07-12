/**
 * Machine-written NFC discovery store: history/triggers/nfc.observed.yml.
 * Separate writer from the curated config bindings (spec/status split).
 * Layer: ADAPTER (1_adapters/persistence/yaml).
 * @module adapters/persistence/yaml/YamlObservedStateStore
 */
export class YamlObservedStateStore {
  #loadFile; #saveFile; #path; #cache = null; #writeChain = Promise.resolve();

  constructor({ loadFile, saveFile, path = 'history/triggers/nfc.observed' } = {}) {
    this.#loadFile = loadFile;
    this.#saveFile = saveFile;
    this.#path = path;
  }

  load() {
    let raw;
    try {
      raw = this.#loadFile?.(this.#path);
    } catch {
      raw = null;
    }
    this.#cache = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    return this.#cache;
  }

  has(uid) {
    return !!(this.#cache && this.#cache[String(uid).toLowerCase()]);
  }

  record(uid, timestampStr) {
    return this.#enqueue(async () => {
      if (!this.#cache) this.load();
      const key = String(uid).toLowerCase();
      const existing = this.#cache[key];
      const entry = existing
        ? { first_seen: existing.first_seen, last_seen: timestampStr, count: (existing.count || 0) + 1 }
        : { first_seen: timestampStr, last_seen: timestampStr, count: 1 };
      this.#cache[key] = entry;
      await Promise.resolve(this.#saveFile?.(this.#path, this.#cache));
      return entry;
    });
  }

  #enqueue(task) {
    const next = this.#writeChain.then(task, task);
    this.#writeChain = next.then(() => undefined, () => undefined);
    return next;
  }
}

export default YamlObservedStateStore;
