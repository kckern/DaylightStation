/**
 * YAML-backed trigger config repository. Public adapter entry — bootstrap
 * calls this. Owns the I/O boundary for both reads (boot-time config load)
 * and writes (placeholder + note mutations to nfc/tags.yml).
 *
 * Layer: ADAPTER (1_adapters/trigger). The dependency-injected `loadFile`
 * and `saveFile` helpers handle YAML I/O (provided by app.mjs); this class
 * only knows the file-path layout and serialization concerns.
 *
 * Writes are serialized through a Promise-chain mutex so two concurrent
 * scans of different unknown tags can't lose writes to each other.
 *
 * @module adapters/trigger/YamlTriggerConfigRepository
 */

import { buildTriggerRegistry } from './parsers/buildTriggerRegistry.mjs';
import { serializeNfcTags } from './parsers/nfcTagsSerializer.mjs';

const PATHS = {
  nfcLocations: 'config/triggers/nfc/locations',
  nfcTags: 'config/triggers/nfc/tags',
  stateLocations: 'config/triggers/state/locations',
};

export class YamlTriggerConfigRepository {
  #saveFile;
  #registry = null;
  #writeChain = Promise.resolve();

  constructor({ saveFile } = {}) {
    this.#saveFile = saveFile || null;
  }

  /**
   * Load all per-modality YAML blobs and assemble the unified trigger registry.
   * Stores the registry internally so write methods can mutate it.
   *
   * @returns {Object} unified registry: { nfc: { locations, tags }, state: { locations } }
   * @throws {ValidationError} if any YAML is malformed.
   */
  loadRegistry({ loadFile }) {
    const blobs = {
      nfcLocations: loadFile(PATHS.nfcLocations),
      nfcTags: loadFile(PATHS.nfcTags),
      stateLocations: loadFile(PATHS.stateLocations),
    };
    this.#registry = buildTriggerRegistry(blobs);
    return this.#registry;
  }

  /**
   * Create a placeholder entry for an unknown NFC tag UID. No-op if entry
   * already exists (init scan time is never updated).
   *
   * @param {string} uid lowercased tag UID
   * @param {string} scannedAt formatted timestamp string
   * @returns {Promise<{created: boolean}>}
   */
  upsertNfcPlaceholder(uid, scannedAt) {
    return this.#enqueue(async () => {
      this.#assertReady();
      const tags = this.#registry.nfc.tags;
      if (tags[uid]) return { created: false };
      tags[uid] = { global: { scanned_at: scannedAt }, overrides: {} };
      await this.#flushTags();
      return { created: true };
    });
  }

  /**
   * Set/overwrite the note on a tag. Idempotent upsert — creates the entry
   * with scanned_at + note if missing.
   *
   * @param {string} uid lowercased tag UID
   * @param {string} note the user-supplied freeform name
   * @param {string} scannedAtIfNew timestamp to use only when creating a new entry
   * @returns {Promise<{created: boolean}>}
   */
  setNfcNote(uid, note, scannedAtIfNew) {
    return this.#enqueue(async () => {
      this.#assertReady();
      const tags = this.#registry.nfc.tags;
      let created = false;
      if (!tags[uid]) {
        tags[uid] = { global: { scanned_at: scannedAtIfNew }, overrides: {} };
        created = true;
      }
      // Backfill scanned_at on promoted tags that never had one
      if (!tags[uid].global.scanned_at) {
        tags[uid].global.scanned_at = scannedAtIfNew;
      }
      tags[uid].global.note = note;
      await this.#flushTags();
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

  #flushTags() {
    const flat = serializeNfcTags(this.#registry.nfc.tags);
    return Promise.resolve(this.#saveFile(PATHS.nfcTags, flat));
  }
}

export default YamlTriggerConfigRepository;
