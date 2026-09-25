/**
 * YAML-backed trigger config repository. Public adapter entry — bootstrap
 * calls this. Owns the I/O boundary for both reads (boot-time config load,
 * plus the tag re-read on an unknown tap) and writes (note mutations to
 * bindings/nfc.yml).
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
 * Trigger config lives under ONE root, `triggers/` (see TRIGGER_ROOT below).
 * Reads and writes both use it; there is no per-file fallback.
 *
 * @module adapters/trigger/YamlTriggerConfigRepository
 */

import { buildTriggerRegistry } from './parsers/buildTriggerRegistry.mjs';
import { serializeNfcTags } from './parsers/nfcTagsSerializer.mjs';
import { canonicalizeNfcUid } from '#domains/trigger/nfcUid.mjs';
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

/**
 * The ONE trigger root. Phase E deleted the retiring `config/triggers/` root
 * along with the rest of `household/config/`.
 *
 * Every read AND every write uses this root; there is deliberately no per-file
 * fallback anywhere in this class, and there never was one across roots either.
 * Why that mattered while two roots existed: a read that fell back while writes
 * always targeted the new root loses data. Trace it — legacy holds
 * bindings/nfc/{books,cards}.yml, grouped is empty, a read falls back and loads
 * both, one note edit flushes ONLY the books subset to the GROUPED root, and
 * next boot the grouped directory wins outright so every cards.yml tag silently
 * disappears. Migration was therefore an atomic move of all files at once. Keep
 * that property if a second root is ever introduced again.
 */
const TRIGGER_ROOT = 'triggers';

const pathsFor = (root) => ({
  sources: `${root}/sources`,
  bindingsNfc: `${root}/bindings/nfc`,
  responses: `${root}/responses`,
  endpoints: `${root}/endpoints`,
});

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
  // uids found in the inbox that a curated file already owns. Collected during
  // load, cleared by sweepInbox().
  #promotedFromInbox = new Set();
  // The ONE root, and the paths derived from it. Both reads and writes go
  // through these.
  #root = TRIGGER_ROOT;
  #paths = pathsFor(TRIGGER_ROOT);
  // The readers loadRegistry was given, kept for refreshNfcTags().
  #reader = null;

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
  loadRegistry({ loadFile, listDir = null, onSkip = null, onWarn = null }) {
    const { registry, nfc } = this.#readRegistry({ loadFile, listDir, onSkip, onWarn });
    this.#commitNfcBindings(nfc);
    this.#registry = registry;
    this.#reader = { loadFile, listDir, onSkip };
    return this.#registry;
  }

  /**
   * Re-read the trigger files and fold any tag bindings into the LIVE registry,
   * in place — the dispatch service holds this same object, so a tag named after
   * boot resolves on its next tap instead of waiting for a restart.
   *
   * Called on a miss, so a failure here must never cost a tag that already
   * works. Two rules keep it that way:
   *   - A read or parse that throws changes nothing. The caller logs it and the
   *     tap falls through to the ordinary unknown-tag path.
   *   - It adds and updates, never removes. A file Dropbox is halfway through
   *     syncing can read as missing without throwing; treating that as "every
   *     book was deleted" would unregister the house. Removing a tag still takes
   *     a restart.
   *
   * Runs on the write queue so it cannot interleave with a note write.
   *
   * @returns {Promise<{added: string[], updated: number}>}
   */
  refreshNfcTags() {
    return this.#enqueue(() => {
      if (!this.#registry || !this.#reader) {
        throw new Error('YamlTriggerConfigRepository: registry not loaded — call loadRegistry first');
      }
      const { registry: fresh, nfc } = this.#readRegistry(this.#reader);
      const live = this.#registry.nfc.tags;
      const added = [];
      let updated = 0;
      for (const [uid, entry] of Object.entries(fresh.nfc.tags)) {
        if (live[uid]) updated += 1; else added.push(uid);
        live[uid] = entry;
        this.#tagSource.set(uid, nfc.tagSource.get(uid) ?? null);
      }
      if (nfc.mode === 'dir') {
        for (const uid of nfc.promoted) this.#promotedFromInbox.add(uid);
      }
      return { added, updated };
    });
  }

  /** Read and parse every trigger file. Pure with respect to this instance. */
  #readRegistry({ loadFile, listDir = null, onSkip = null, onWarn = null }) {
    const nfc = this.#loadNfcBindings({ loadFile, listDir });
    const blobs = {
      sources: loadFile(this.#paths.sources),
      bindingsNfc: nfc.merged,
      responses: loadFile(this.#paths.responses),
      endpoints: loadFile(this.#paths.endpoints),
    };
    return { registry: buildTriggerRegistry(blobs, { onSkip, onWarn }), nfc };
  }

  #commitNfcBindings({ mode, tagSource, promoted }) {
    this.#tagFileMode = mode;
    this.#tagSource = tagSource;
    this.#promotedFromInbox = promoted;
  }

  /** The root this registry was loaded from (and writes back to). */
  get root() { return this.#root; }

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
   * {@link DEFAULT_TAG_FILE} is the ONE exception, because it is not a peer of
   * the curated files — it is the inbox they are curated OUT OF. The app writes
   * a stub there itself on first sight of an unknown tag; a human then pastes
   * the real entry into books.yml or cards.yml. That workflow PRODUCES a
   * duplicate every single time, so treating it as ambiguity meant the routine
   * act of naming a book took the whole tag registry down until someone noticed
   * and hand-edited the inbox. (It did: a book named at 17:51 left every NFC tag
   * in the house unregistered from the next boot until 17:59.)
   *
   * So a uid in both the inbox and a curated file is not ambiguous at all — the
   * curated entry wins, and the stub is DELETED from the inbox on the spot.
   * Ambiguity between two CURATED files is still a hard error: there, nothing
   * says which the author meant.
   *
   * Remembers which file each uid came from so a later note write goes back to
   * that file instead of collapsing every group into one.
   *
   * Touches no instance state: it returns what it found, and the caller commits
   * it. A throw halfway through a re-read must leave the live bookkeeping alone.
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

    const tagSource = new Map();
    const promoted = new Set();

    // Legacy single-file mode: everything belongs to that one file.
    if (!files.length) {
      for (const rawUid of Object.keys(single || {})) {
        tagSource.set(canonicalizeNfcUid(rawUid), null); // null => the single file
      }
      return { mode: 'single', merged: single, tagSource, promoted };
    }

    const merged = {};
    // Read the curated files FIRST and the inbox last, so "already curated" is
    // always a fact by the time an inbox stub is considered — independent of
    // readdir order, which is what made the old rule depend on the filesystem.
    const curated = files.filter((f) => f !== DEFAULT_TAG_FILE);
    const inbox = files.filter((f) => f === DEFAULT_TAG_FILE);
    const rawKeyFor = new Map();

    for (const file of [...curated, ...inbox]) {
      const blob = loadFile(`${dirPath}/${file.replace(/\.ya?ml$/i, '')}`);
      for (const [rawUid, entry] of Object.entries(blob || {})) {
        const uid = canonicalizeNfcUid(rawUid);
        const prior = tagSource.get(uid);

        if (prior !== undefined) {
          // The inbox never wins and never argues: the curated entry stands and
          // the stub is swept up below.
          if (file === DEFAULT_TAG_FILE) {
            promoted.add(uid);
            continue;
          }
          // A curated file colliding with the inbox read earlier is impossible
          // (the inbox is read last), so this is curated-vs-curated: genuine
          // ambiguity, and nothing here can say which the author meant. Name
          // both files so the fix is obvious.
          throw new ValidationError(
            `tag "${rawUid}" appears in both ${dirPath}/${prior} and ${dirPath}/${file}`,
            { code: 'DUPLICATE_TAG_ACROSS_FILES', field: rawUid, files: [prior, file] }
          );
        }
        tagSource.set(uid, file);
        rawKeyFor.set(uid, rawUid);
        merged[rawUid] = entry;
      }
    }
    return { mode: 'dir', merged, tagSource, promoted };
  }

  /**
   * Rewrite the inbox without the stubs that have since been curated elsewhere.
   *
   * Called after a successful load, never during one: a read must not depend on
   * a write having succeeded, and a read-only deployment (no `saveFile`) has to
   * keep booting. The registry in memory is already correct either way — this
   * only stops the same stubs being re-swept on every boot, and keeps the inbox
   * meaning what it says: tags nobody has named yet.
   *
   * @returns {Promise<{swept: string[]}>} the uids removed from the inbox.
   */
  sweepInbox() {
    const swept = [...this.#promotedFromInbox];
    if (!swept.length || !this.#saveFile || this.#tagFileMode !== 'dir') {
      return Promise.resolve({ swept: [] });
    }
    return this.#enqueue(() => {
      const keep = {};
      for (const [rawUid, entry] of Object.entries(this.#registry?.nfc?.tags || {})) {
        if ((this.#tagSource.get(canonicalizeNfcUid(rawUid)) ?? null) === DEFAULT_TAG_FILE) {
          keep[rawUid] = entry;
        }
      }
      const relPath = `${this.#paths.bindingsNfc}/${DEFAULT_TAG_FILE.replace(/\.ya?ml$/i, '')}`;
      return Promise.resolve(this.#saveFile(relPath, serializeNfcTags(keep)))
        .then(() => {
          this.#promotedFromInbox.clear();
          return { swept };
        });
    });
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
