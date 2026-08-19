// backend/src/1_adapters/content/surround/SurroundStore.mjs
import path from 'path';
import {
  dirExists,
  listDirs,
  listYamlFiles,
  loadYamlFromPath
} from '#system/utils/FileIO.mjs';
import { deepMerge } from '#system/utils/deepMerge.mjs';

// Definitions live in this reserved folder; every other `_`-prefixed name under
// the tree (folders and files alike) is authoring scaffolding, never a piece.
const DEFINITIONS_DIR = '_surrounds';
const COMPOSER_FILE = '_composer';

const isReserved = (name) => name.startsWith('_');
// Titles are compared on letters and digits only. Everything else — guillemets
// (»«), interpuncts (∙), colons, hyphens, whitespace runs — is separator noise
// that the Plex title carries and the sidecar's authored title does not. The
// \p{L}/\p{N} classes are Unicode-aware, so `Andrés` survives intact.
const normalizeTitle = (v) =>
  (typeof v === 'string' ? v : '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const asArray = (v) => (Array.isArray(v) ? v : []);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Index of authored surround sidecars.
 *
 * Tree shape: <rootDir>/<domain>/<composer>/<piece>.yml, with shared composer
 * identity in <composer>/_composer.yml and region layouts in _surrounds/.
 * A surround is enrichment attached to playback responses, not playable
 * content, so this is a plain store — it is not registered as a content source.
 */
export class SurroundStore {
  #byContentId = new Map();
  // Parallel to #byContentId: the rebind lane, walked only after an id miss.
  #byTitle = [];

  /**
   * @param {Object} options
   * @param {string} options.rootDir - Root of the sidecar tree (data/content/surround)
   * @param {Object} options.logger - Structured logger
   */
  constructor({ rootDir, logger }) {
    this.rootDir = rootDir;
    // The composed logger arrives as the content router's child (app: 'api'), which
    // would bury surround events among all other content logging. Claim our own
    // `context.app` so the log store can filter this subsystem on its own. The
    // optional call is required: contentApi falls back to bare `console`, which
    // has no child().
    this.logger = logger?.child?.({ app: 'surround', module: 'surround-store' }) ?? logger;
    this.#build();
  }

  /**
   * Resolve the surround payload for a played item.
   * Never throws: a miss, an unreadable tree, or a broken sidecar all yield null
   * so the caller attaches nothing and playback is unaffected.
   *
   * The contentId is the fast path. A Plex rescan mints fresh ratingKeys, which
   * would otherwise orphan every sidecar at once with no symptom but a missing
   * frame, so a miss falls back to matching the authored `match.title` against
   * the live one. The warn it logs is how anyone learns the ids went stale.
   * That fallback answers only when it is sure: two sidecars matching the same
   * live title yield null, not a coin flip.
   *
   * Returns a fresh clone each call. The payload is attached verbatim to play
   * and queue responses, where callers may decorate it (asset URLs, defaults);
   * handing out the indexed object would let one such edit persist into every
   * later lookup, and definition blocks are shared across pieces.
   *
   * @param {string} contentId - Compound content ID (e.g. 'plex:663134')
   * @param {string} title - Item title
   * @returns {Object|null} Resolved surround payload, or null
   */
  lookup(contentId, title) {
    try {
      const payload = this.#byContentId.get(String(contentId));
      if (payload) return structuredClone(payload);

      const candidates = this.#rebind(title);
      if (candidates.length === 1) {
        const [rebound] = candidates;
        // Warn, not info: the sidecar still works, but its contentId is wrong and
        // the message carries everything needed to fix the file by hand.
        this.logger?.warn?.('surround.match.rebound', {
          staleContentId: contentId,
          matchedTitle: rebound.title,
          file: rebound.file,
          contentId: rebound.contentId
        });
        return structuredClone(rebound.payload);
      }
      if (candidates.length > 1) {
        // Refuse rather than guess. A wrong surround is a visible error to whoever
        // is watching — Beethoven's facts pinned over a Vivaldi video — while a
        // missing one is just the un-enriched status quo. Every candidate file is
        // named so the author knows exactly which titles to disambiguate.
        this.logger?.warn?.('surround.match.ambiguous', {
          staleContentId: contentId,
          liveTitle: title,
          candidates: candidates.map(({ file, title: matchedTitle }) => ({ file, title: matchedTitle }))
        });
        return null;
      }

      // The only trace an authoring mistake leaves: failing soft means a wrong
      // contentId is otherwise indistinguishable from an unauthored item.
      this.logger?.debug?.('surround.lookup.miss', { contentId });
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Collect every piece whose authored title matches the live one, ids having gone stale.
   *
   * Substring, not equality, and in both directions: the live Plex title usually
   * appends the orchestra and conductor to the authored one, but an authored title
   * may equally be the more specific of the two. An empty normalization (a missing
   * or non-string title on either side) matches nothing rather than everything.
   *
   * Every match is returned, never just the first: substring matching is lossy
   * enough that a short authored title (`Spring`) hits whole families of live
   * titles, and picking by walk order would make the answer depend on the
   * filesystem. The caller decides what more than one match means.
   *
   * @param {string} title - Live item title
   * @returns {Array<{ title: string, file: string, contentId: string, payload: Object }>}
   * @private
   */
  #rebind(title) {
    const live = normalizeTitle(title);
    if (!live) return [];

    return this.#byTitle.filter(({ normalized }) =>
      normalized.includes(live) || live.includes(normalized));
  }

  /**
   * Walk the sidecar tree and build the contentId index.
   * @private
   */
  #build() {
    const startedAt = Date.now();
    const index = new Map();
    const titles = [];
    let composers = 0;
    // Piece candidates read but rejected. A malformed definition shows up here too,
    // as every piece naming it is rejected in turn.
    let skipped = 0;
    let definitions = new Map();

    try {
      definitions = this.#loadDefinitions();

      for (const domain of listDirs(this.rootDir).filter((d) => !isReserved(d))) {
        const domainDir = path.join(this.rootDir, domain);

        for (const composer of listDirs(domainDir).filter((d) => !isReserved(d))) {
          const composerDir = path.join(domainDir, composer);
          const composerBase = loadYamlFromPath(path.join(composerDir, `${COMPOSER_FILE}.yml`));
          if (isPlainObject(composerBase)) composers += 1;

          const files = listYamlFiles(composerDir, { stripExtension: false })
            .filter((f) => !isReserved(f));

          for (const file of files) {
            const resolved = this.#resolvePiece(path.join(composerDir, file), domain, composerBase, definitions);
            if (!resolved) { skipped += 1; continue; }
            index.set(resolved.contentId, resolved.payload);
            // Only pieces that authored a title are rebindable; the rest are
            // reachable by contentId alone. The path is relative so the log line
            // names the file the way the author knows it.
            if (resolved.normalized) {
              titles.push({
                normalized: resolved.normalized,
                title: resolved.title,
                file: path.join(domain, composer, file),
                contentId: resolved.contentId,
                payload: resolved.payload
              });
            }
          }
        }
      }
    } catch {
      // A malformed root leaves whatever was indexed so far; lookups miss quietly.
    }

    this.#byContentId = index;
    this.#byTitle = titles;
    if (typeof this.logger?.info !== 'function') return;
    this.logger.info('surround.index.built', {
      pieces: index.size,
      skipped,
      composers,
      definitions: definitions.size,
      ms: Date.now() - startedAt
    });
  }

  /**
   * Load region-layout definitions, keyed by filename stem.
   * @returns {Map<string, Object>}
   * @private
   */
  #loadDefinitions() {
    const dir = path.join(this.rootDir, DEFINITIONS_DIR);
    const out = new Map();
    if (!dirExists(dir)) return out;

    for (const file of listYamlFiles(dir, { stripExtension: false })) {
      const parsed = loadYamlFromPath(path.join(dir, file));
      if (!parsed || typeof parsed !== 'object') continue;
      // The filename stem is the lookup key — `id:` inside the file is decorative.
      out.set(file.replace(/\.(yml|yaml)$/, ''), parsed);
    }
    return out;
  }

  /**
   * Read one piece sidecar and resolve it into the payload the API attaches verbatim.
   * @returns {{ contentId: string, title: string, normalized: string, payload: Object }|null}
   * @private
   */
  #resolvePiece(filePath, domain, composerBase, definitions) {
    const doc = loadYamlFromPath(filePath);
    if (!doc || typeof doc !== 'object') return null;
    if (!doc.surround || !doc.match?.contentId) return null;

    const definition = definitions.get(doc.surround);
    if (!definition) return null;

    // Shapes are guarded, not trusted: an indentation slip that turns `movements`
    // into a string would otherwise reach a module's .map() and throw in render,
    // taking the player subtree down with it.
    return {
      // YAML parses a bare `contentId: 663134` as a number; keys are always strings.
      contentId: String(doc.match.contentId),
      title: typeof doc.match.title === 'string' ? doc.match.title : '',
      normalized: normalizeTitle(doc.match.title),
      payload: {
        id: doc.surround,
        definition: { regions: definition.regions, collapse: definition.collapse },
        piece: isPlainObject(doc.piece) ? doc.piece : {},
        movements: asArray(doc.movements),
        cues: asArray(doc.cues),
        facts: asArray(doc.facts),
        // Piece-level `composer:` overrides the shared _composer.yml, key by key.
        composer: deepMerge(
          isPlainObject(composerBase) ? composerBase : {},
          isPlainObject(doc.composer) ? doc.composer : {}
        ),
        assetBase: `surround/${domain}`
      }
    };
  }
}

export default SurroundStore;
