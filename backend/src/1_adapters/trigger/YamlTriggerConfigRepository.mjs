/**
 * YAML-backed trigger config repository. Public adapter entry — bootstrap
 * calls this. Owns the I/O boundary for both reads (boot-time config load)
 * and writes (note mutations to bindings/nfc.yml).
 *
 * Layer: ADAPTER (1_adapters/trigger). The dependency-injected `loadFile`
 * and `saveFile` helpers handle YAML I/O (provided by app.mjs); this class
 * only knows the file-path layout and serialization concerns.
 *
 * Spec/status split: curated config (sources, bindings, responses,
 * endpoints) is written here; machine-observed state (first/last-seen scan
 * timestamps) is delegated to the injected `observedStore`
 * (YamlObservedStateStore) which owns history/triggers/nfc.observed.yml.
 * This class never writes observed state into config.
 *
 * Writes are serialized through a Promise-chain mutex so two concurrent
 * scans of different unknown tags can't lose writes to each other.
 *
 * @module adapters/trigger/YamlTriggerConfigRepository
 */

import { buildTriggerRegistry } from './parsers/buildTriggerRegistry.mjs';
import { serializeNfcTags } from './parsers/nfcTagsSerializer.mjs';

const PATHS = {
  sources: 'config/triggers/sources',
  bindingsNfc: 'config/triggers/bindings/nfc',
  responses: 'config/triggers/responses',
  endpoints: 'config/triggers/endpoints',
};

export class YamlTriggerConfigRepository {
  #saveFile;
  #observedStore;
  #registry = null;
  #writeChain = Promise.resolve();

  constructor({ saveFile, observedStore } = {}) {
    this.#saveFile = typeof saveFile === 'function' ? saveFile : null;
    this.#observedStore = observedStore || null;
  }

  /**
   * Load all per-modality YAML blobs and assemble the unified trigger registry.
   * Stores the registry internally so write methods can mutate it.
   *
   * @returns {Object} unified registry: { nfc: { locations, tags }, state: { locations }, responses, endpoints }
   * @throws {ValidationError} if any YAML is malformed.
   */
  loadRegistry({ loadFile }) {
    const blobs = {
      sources: loadFile(PATHS.sources),
      bindingsNfc: loadFile(PATHS.bindingsNfc),
      responses: loadFile(PATHS.responses),
      endpoints: loadFile(PATHS.endpoints),
    };
    this.#registry = buildTriggerRegistry(blobs);
    return this.#registry;
  }

  /**
   * Record an observed NFC scan in the machine-written history store.
   * Never writes to config — delegates entirely to the injected
   * observedStore. No-op (created: false) if no observedStore is configured.
   *
   * @param {string} uid lowercased tag UID
   * @param {string} scannedAt formatted timestamp string
   * @returns {Promise<{created: boolean}>} created = first sighting of this uid
   */
  recordObserved(uid, scannedAt) {
    if (!this.#observedStore) return Promise.resolve({ created: false });
    const key = String(uid).toLowerCase();
    const firstSight = !this.#observedStore.has(key);
    return Promise.resolve(this.#observedStore.record(key, scannedAt)).then(() => ({ created: firstSight }));
  }

  /**
   * Set/overwrite the note on a tag. Idempotent upsert — creates the
   * bindings entry if missing. The note is curated config (written to
   * bindings/nfc.yml); the scan timestamp is observed state (delegated to
   * the observedStore for history).
   *
   * @param {string} uid lowercased tag UID
   * @param {string} note the user-supplied freeform name
   * @param {string} scannedAtIfNew timestamp to record in history
   * @returns {Promise<{created: boolean}>} created = binding newly created
   */
  setNfcNote(uid, note, scannedAtIfNew) {
    return this.#enqueue(async () => {
      this.#assertReady();
      const tags = this.#registry.nfc.tags;
      const key = String(uid).toLowerCase();
      let created = false;
      if (!tags[key]) {
        tags[key] = { global: {}, overrides: {} };
        created = true;
      }
      tags[key].global.note = note;
      await this.#flushBindings();
      if (this.#observedStore) await this.#observedStore.record(key, scannedAtIfNew);
      return { created };
    });
  }

  // Serialize all writes through a single Promise chain. Each call awaits the
  // prior chain head before doing its own work. Errors don't poison the chain.
  #enqueue(task) {
    const next = this.#writeChain.then(task, task);
    // Detach from the chain so a rejection in this task doesn't propagate
    // forward (still surfaces to the caller via the returned promise).
    this.#writeChain = next.then(() => undefined, () => undefined);
    return next;
  }

  #assertReady() {
    if (!this.#registry) {
      throw new Error('YamlTriggerConfigRepository: registry not loaded — call loadRegistry first');
    }
    if (!this.#saveFile) {
      throw new Error('YamlTriggerConfigRepository: saveFile not configured — write methods unavailable');
    }
  }

  #flushBindings() {
    const flat = serializeNfcTags(this.#registry.nfc.tags);
    return Promise.resolve(this.#saveFile(PATHS.bindingsNfc, flat));
  }
}

export default YamlTriggerConfigRepository;
