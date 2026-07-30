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
import { canonicalizeNfcUid } from '#domains/trigger/nfcUid.mjs';
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const PATHS = {
  sources: 'config/triggers/sources',
  bindingsNfc: 'config/triggers/bindings/nfc',
  responses: 'config/triggers/responses',
  endpoints: 'config/triggers/endpoints',
};

/** Directory form of the NFC bindings: one file per group (books, cards, …). */
const BINDINGS_NFC_DIR = 'config/triggers/bindings/nfc';
/** Where a tag with no declared home lands. */
const DEFAULT_TAG_FILE = 'unsorted.yml';

export class YamlTriggerConfigRepository {
  #saveFile;
  #observedStore;
  #registry = null;
  #writeChain = Promise.resolve();
  // canonical uid -> the grouped file it came from ('books.yml'), or null when
  // the registry is a single legacy file. Drives round-trip writes.
  #tagSource = new Map();
  #tagFileMode = 'single';

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
  loadRegistry({ loadFile, listDir = null }) {
    const blobs = {
      sources: loadFile(PATHS.sources),
      bindingsNfc: this.#loadNfcBindings({ loadFile, listDir }),
      responses: loadFile(PATHS.responses),
      endpoints: loadFile(PATHS.endpoints),
    };
    this.#registry = buildTriggerRegistry(blobs);
    return this.#registry;
  }

  /**
   * NFC bindings live EITHER as one `bindings/nfc.yml` or as a directory of
   * grouped files (`bindings/nfc/books.yml`, `cards.yml`, …). Grouping exists
   * because one monolith mixes unrelated things — audiobooks and personal
   * identity cards — and makes every edit a merge risk.
   *
   * Both forms present is a HARD ERROR, not a merge. This household already lost
   * an afternoon to two plausible-looking tag files diverging (62 entries in a
   * stale path, 58 in the live one) with nothing to say which was authoritative.
   * Refusing to boot is the cheap version of that lesson.
   *
   * Remembers which file each uid came from so a later note write goes back to
   * that file instead of collapsing every group into one.
   */
  #loadNfcBindings({ loadFile, listDir }) {
    const files = typeof listDir === 'function' ? (listDir(BINDINGS_NFC_DIR) || []) : [];
    const single = loadFile(PATHS.bindingsNfc);

    if (files.length && single && Object.keys(single).length) {
      throw new ValidationError(
        `NFC bindings exist BOTH as ${PATHS.bindingsNfc}.yml and as files in ${BINDINGS_NFC_DIR}/ `
        + `(${files.join(', ')}). Move the single file's entries into the directory and delete it — `
        + 'two sources of truth for one tag registry is how a card silently resolves to the wrong thing.',
        { code: 'NFC_BINDINGS_AMBIGUOUS', files }
      );
    }

    // Legacy single-file mode: everything belongs to that one file.
    if (!files.length) {
      this.#tagFileMode = 'single';
      this.#tagSource.clear();
      for (const rawUid of Object.keys(single || {})) {
        this.#tagSource.set(canonicalizeNfcUid(rawUid), null); // null => the single file
      }
      return single;
    }

    this.#tagFileMode = 'dir';
    this.#tagSource.clear();
    const merged = {};
    for (const file of files) {
      const blob = loadFile(`${BINDINGS_NFC_DIR}/${file.replace(/\.ya?ml$/i, '')}`);
      for (const [rawUid, entry] of Object.entries(blob || {})) {
        const uid = canonicalizeNfcUid(rawUid);
        const prior = this.#tagSource.get(uid);
        // Which file wins would otherwise depend on readdir order — i.e. on the
        // filesystem. Name both files so the fix is obvious.
        if (prior !== undefined) {
          throw new ValidationError(
            `tag "${rawUid}" appears in both ${BINDINGS_NFC_DIR}/${prior} and ${BINDINGS_NFC_DIR}/${file}`,
            { code: 'DUPLICATE_TAG_ACROSS_FILES', field: rawUid, files: [prior, file] }
          );
        }
        this.#tagSource.set(uid, file);
        merged[rawUid] = entry;
      }
    }
    return merged;
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
    const key = canonicalizeNfcUid(uid);
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
      const key = canonicalizeNfcUid(uid);
      let created = false;
      if (!tags[key]) {
        tags[key] = { global: {}, overrides: {} };
        created = true;
      }
      tags[key].global.note = note;
      if (!this.#tagSource.has(key)) {
        // A tag nobody has filed yet. It gets an explicit home rather than being
        // appended to whichever group happened to load last.
        this.#tagSource.set(key, this.#tagFileMode === 'dir' ? DEFAULT_TAG_FILE : null);
      }
      await this.#flushBindings(key);
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

  /**
   * Write back ONLY the file the touched tag belongs to.
   *
   * The previous version serialized the whole registry into one path. Against a
   * grouped layout that would have quietly re-monolithized the split on the very
   * first note edit — books and cards collapsed back into one file, which is the
   * thing the grouping exists to prevent.
   *
   * @param {string} uid canonical uid whose file should be rewritten
   */
  #flushBindings(uid) {
    const file = this.#tagSource.get(uid) ?? null;
    if (file === null) {
      // Legacy single-file registry: unchanged behaviour.
      return Promise.resolve(this.#saveFile(PATHS.bindingsNfc, serializeNfcTags(this.#registry.nfc.tags)));
    }
    const subset = {};
    for (const [u, entry] of Object.entries(this.#registry.nfc.tags)) {
      if ((this.#tagSource.get(u) ?? null) === file) subset[u] = entry;
    }
    const relPath = `${BINDINGS_NFC_DIR}/${file.replace(/\.ya?ml$/i, '')}`;
    return Promise.resolve(this.#saveFile(relPath, serializeNfcTags(subset)));
  }
}

export default YamlTriggerConfigRepository;
