// backend/src/1_adapters/content/sequence/YamlSequenceStore.mjs
import path from 'path';
import { getStats, listDirs, listYamlFiles, loadYamlFromPath } from '#system/utils/FileIO.mjs';
import { ISequenceStore } from '#apps/content/ports/ISequenceStore.mjs';
import { normalizeSequence } from '#domains/content/utils/stationSequence.mjs';

// How long a lookup trusts the index without stat-ing the tree — the same
// edit-refresh window the surround store uses, so authoring a station needs no
// backend restart.
const FRESHNESS_WINDOW_MS = 2000;
// `_`-prefixed names are scaffolding (frame definitions, drafts), never content.
const isReserved = (name) => name.startsWith('_');
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Station-sequence sidecars, read from the surround sidecar tree.
 *
 * A sequence sidecar is any YAML under the tree carrying a `sequence:` block,
 * bound to a container by `match.contentId`. It shares the tree with surround
 * performance sidecars because a station's frame (logo, vintage rendering) will
 * live in the same file — but the two are read by separate stores: the surround
 * store skips a sequence-only file, and this store ignores every file without
 * `sequence:`. Unlike the surround tree's fixed domain/composer/piece shape,
 * files are found at any depth.
 *
 * Never throws: a broken tree or sidecar costs that station its sequence, and
 * its queue plays exactly as it would without one.
 */
export class YamlSequenceStore extends ISequenceStore {
  #byContentId = new Map();
  // Newest mtime the serving index was built from — compared against the tree,
  // not against a clock, so the check is immune to clock skew.
  #builtMtime = -1;
  #lastCheckedAt = -Infinity;

  /**
   * @param {Object} options
   * @param {string} options.rootDir - Root of the sidecar tree (data/content/surround)
   * @param {Object} [options.logger] - Structured logger
   * @param {() => number} [options.now] - Clock for the freshness window
   */
  constructor({ rootDir, logger = null, now = () => Date.now() }) {
    super();
    this.rootDir = rootDir;
    this.now = now;
    this.logger = logger?.child?.({ app: 'surround', module: 'sequence-store' }) ?? logger;
    this.#refresh(true);
  }

  lookup(contentId) {
    try {
      this.#refresh(false);
      const hit = this.#byContentId.get(String(contentId));
      return hit ? structuredClone(hit.sequence) : null;
    } catch {
      return null;
    }
  }

  /** Every non-reserved YAML file under the root, as { full, rel }. @private */
  #walk() {
    const files = [];
    const dirs = [];
    const descend = (dir, rel) => {
      dirs.push(dir);
      for (const file of listYamlFiles(dir, { stripExtension: false })) {
        if (!isReserved(file)) files.push({ full: path.join(dir, file), rel: path.join(rel, file) });
      }
      for (const child of listDirs(dir)) {
        if (!isReserved(child)) descend(path.join(dir, child), path.join(rel, child));
      }
    };
    descend(this.rootDir, '');
    return { files, dirs };
  }

  /** @private */
  #refresh(force) {
    try {
      const now = this.now();
      if (!force && now - this.#lastCheckedAt <= FRESHNESS_WINDOW_MS) return;
      this.#lastCheckedAt = now;

      const { files, dirs } = this.#walk();
      // Directories count: a directory mtime is the only trace of a deleted file.
      let newest = 0;
      for (const target of [...dirs, ...files.map((f) => f.full)]) {
        const stats = getStats(target);
        if (stats) newest = Math.max(newest, Math.floor(stats.mtimeMs));
      }
      if (!force && newest <= this.#builtMtime) return;

      this.#byContentId = this.#build(files);
      this.#builtMtime = newest;
    } catch (err) {
      // The last good index keeps serving.
      this.logger?.error?.('station.sequence.walk-failed', { message: err?.message ?? String(err) });
    }
  }

  /** @private */
  #build(files) {
    const index = new Map();
    for (const { full, rel } of files) {
      const doc = loadYamlFromPath(full);
      if (!isPlainObject(doc) || !Object.prototype.hasOwnProperty.call(doc, 'sequence')) continue;

      const contentId = isPlainObject(doc.match) && doc.match.contentId ? String(doc.match.contentId).trim() : '';
      if (!contentId) {
        this.logger?.warn?.('station.sequence.invalid', { file: rel, problems: ['missing-match-contentId'] });
        continue;
      }
      const { sequence, problems } = normalizeSequence(doc.sequence);
      if (problems.length) this.logger?.warn?.('station.sequence.invalid', { file: rel, problems });
      if (!sequence) continue;

      const prior = index.get(contentId);
      if (prior) {
        this.logger?.warn?.('station.sequence.duplicate', { contentId, keptFile: rel, droppedFile: prior.file });
      }
      index.set(contentId, { sequence, file: rel });
    }
    this.logger?.info?.('station.sequence.indexed', { count: index.size });
    return index;
  }
}

export default YamlSequenceStore;
