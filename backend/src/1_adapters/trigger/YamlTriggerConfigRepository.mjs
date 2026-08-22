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
 * (YamlObservedStateStore) which owns triggers/nfc.observed.yml.
 * This class never writes observed state into config.
 *
 * Writes are serialized through a Promise-chain mutex so two concurrent
 * scans of different unknown tags can't lose writes to each other.
 *
 * Trigger config lives under ONE root, resolved per load (see TRIGGER_ROOT
 * below). Reads and writes both use it; there is no per-file fallback.
 *
 * @module adapters/trigger/YamlTriggerConfigRepository
 */

import { buildTriggerRegistry } from './parsers/buildTriggerRegistry.mjs';
import { serializeNfcTags } from './parsers/nfcTagsSerializer.mjs';
import { canonicalizeNfcUid } from '#domains/trigger/nfcUid.mjs';
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

/** Grouped (destination) root. */
const TRIGGER_ROOT = 'triggers';
/** The retiring flat root. Deleted once the data move lands. */
const LEGACY_TRIGGER_ROOT = 'config/triggers';

/**
 * ONE root is resolved per load, and every read AND every write then uses it.
 * There is deliberately no per-file fallback anywhere in this class.
 *
 * Why not "read falls back to legacy, write always targets the new root": that
 * loses data. Trace it — legacy holds bindings/nfc/{books,cards}.yml and the
 * grouped root is empty. A read falls back and loads both. One note edit on a
 * books tag flushes ONLY the books subset, to the GROUPED root. Next boot the
 * grouped bindings directory is non-empty, so it wins outright and the legacy
 * root is never consulted: every cards.yml tag silently disappears. Resolving a
 * single root makes that split impossible — migration is an atomic move of all
 * the files at once, and no incremental write can half-migrate the tree.
 */
const pathsFor = (root) => ({
  sources: `${root}/sources`,
  bindingsNfc: `${root}/bindings/nfc`,
  responses: `${root}/responses`,
  endpoints: `${root}/endpoints`,
});

/** Where a tag with no declared home lands. */
const DEFAULT_TAG_FILE = 'unsorted.yml';

/** A YAML blob counts as "present" only if it actually holds entries. */
const hasEntries = (blob) => Boolean(blob) && typeof blob === 'object' && Object.keys(blob).length > 0;

/**
 * Which trigger CONFIG files exist under `root`. Deliberately probes the config
 * surface (sources / responses / endpoints / bindings) and NOT the whole
 * directory: `triggers/nfc.observed.yml` is machine-written runtime state and
 * already lives under the grouped root today, so a bare "is triggers/ non-empty"
 * test would select the grouped root right now and lose every binding.
 */
function configSurface(root, { loadFile, listDir }) {
  const paths = pathsFor(root);
  const found = [];
  for (const facet of ['sources', 'responses', 'endpoints', 'bindingsNfc']) {
    if (hasEntries(loadFile(paths[facet]))) found.push(paths[facet]);
  }
  const dir = typeof listDir === 'function' ? (listDir(paths.bindingsNfc) || []) : [];
  if (dir.length) found.push(`${paths.bindingsNfc}/`);
  return found;
}

export class YamlTriggerConfigRepository {
  #saveFile;
  #observedStore;
  #registry = null;
  #writeChain = Promise.resolve();
  // canonical uid -> the grouped file it came from ('books.yml'), or null when
  // the registry is a single legacy file. Drives round-trip writes.
  #tagSource = new Map();
  #tagFileMode = 'single';
  // The ONE resolved root, and the paths derived from it. Both reads and writes
  // go through these; nothing in this class may reach for the other root.
  #root = LEGACY_TRIGGER_ROOT;
  #paths = pathsFor(LEGACY_TRIGGER_ROOT);

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
    this.#resolveRoot({ loadFile, listDir });
    const blobs = {
      sources: loadFile(this.#paths.sources),
      bindingsNfc: this.#loadNfcBindings({ loadFile, listDir }),
      responses: loadFile(this.#paths.responses),
      endpoints: loadFile(this.#paths.endpoints),
    };
    this.#registry = buildTriggerRegistry(blobs);
    return this.#registry;
  }

  /** The root this registry was loaded from (and writes back to). */
  get root() { return this.#root; }

  /**
   * Pick the single root for this load: the grouped `triggers/` if it holds any
   * trigger config, otherwise the retiring `config/triggers/`.
   *
   * Config under BOTH roots is a HARD ERROR for the same reason the single-file
   * / directory collision is: a half-migrated tree has two plausible sources of
   * truth and nothing to say which is authoritative. Refusing to boot is the
   * cheap version of that lesson — and with one root resolved per load, only a
   * human or an interrupted migration can produce this state, never a write.
   */
  #resolveRoot({ loadFile, listDir }) {
    const grouped = configSurface(TRIGGER_ROOT, { loadFile, listDir });
    const legacy = configSurface(LEGACY_TRIGGER_ROOT, { loadFile, listDir });

    if (grouped.length && legacy.length) {
      throw new ValidationError(
        `trigger config exists under BOTH ${TRIGGER_ROOT}/ (${grouped.join(', ')}) and `
        + `${LEGACY_TRIGGER_ROOT}/ (${legacy.join(', ')}). Finish the move — put every trigger `
        + 'file under one root and delete the other. Two roots for one trigger registry is how a '
        + 'tag silently resolves to the wrong thing, or stops resolving at all.',
        { code: 'TRIGGER_ROOTS_AMBIGUOUS', grouped, legacy }
      );
    }

    this.#root = grouped.length ? TRIGGER_ROOT : LEGACY_TRIGGER_ROOT;
    this.#paths = pathsFor(this.#root);
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
    const dirPath = this.#paths.bindingsNfc;
    const files = typeof listDir === 'function' ? (listDir(dirPath) || []) : [];
    const single = loadFile(this.#paths.bindingsNfc);

    if (files.length && single && Object.keys(single).length) {
      throw new ValidationError(
        `NFC bindings exist BOTH as ${this.#paths.bindingsNfc}.yml and as files in ${dirPath}/ `
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
      const blob = loadFile(`${dirPath}/${file.replace(/\.ya?ml$/i, '')}`);
      for (const [rawUid, entry] of Object.entries(blob || {})) {
        const uid = canonicalizeNfcUid(rawUid);
        const prior = this.#tagSource.get(uid);
        // Which file wins would otherwise depend on readdir order — i.e. on the
        // filesystem. Name both files so the fix is obvious.
        if (prior !== undefined) {
          throw new ValidationError(
            `tag "${rawUid}" appears in both ${dirPath}/${prior} and ${dirPath}/${file}`,
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
      // Single-file registry: unchanged behaviour, written back to the root the
      // registry was loaded from.
      return Promise.resolve(this.#saveFile(this.#paths.bindingsNfc, serializeNfcTags(this.#registry.nfc.tags)));
    }
    const subset = {};
    for (const [u, entry] of Object.entries(this.#registry.nfc.tags)) {
      if ((this.#tagSource.get(u) ?? null) === file) subset[u] = entry;
    }
    const relPath = `${this.#paths.bindingsNfc}/${file.replace(/\.ya?ml$/i, '')}`;
    return Promise.resolve(this.#saveFile(relPath, serializeNfcTags(subset)));
  }
}

export default YamlTriggerConfigRepository;
