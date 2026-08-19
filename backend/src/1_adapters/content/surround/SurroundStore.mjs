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

  /**
   * @param {Object} options
   * @param {string} options.rootDir - Root of the sidecar tree (data/content/surround)
   * @param {Object} options.logger - Structured logger
   */
  constructor({ rootDir, logger }) {
    this.rootDir = rootDir;
    this.logger = logger;
    this.#build();
  }

  /**
   * Resolve the surround payload for a played item.
   * Never throws: a miss, an unreadable tree, or a broken sidecar all yield null
   * so the caller attaches nothing and playback is unaffected.
   *
   * @param {string} contentId - Compound content ID (e.g. 'plex:663134')
   * @param {string} title - Item title
   * @returns {Object|null} Resolved surround payload, or null
   */
  lookup(contentId, title) {
    try {
      return this.#byContentId.get(contentId) || null;
    } catch {
      return null;
    }
  }

  /**
   * Walk the sidecar tree and build the contentId index.
   * @private
   */
  #build() {
    const startedAt = Date.now();
    const index = new Map();
    let composers = 0;
    let definitions = new Map();

    try {
      definitions = this.#loadDefinitions();

      for (const domain of listDirs(this.rootDir).filter((d) => !isReserved(d))) {
        const domainDir = path.join(this.rootDir, domain);

        for (const composer of listDirs(domainDir).filter((d) => !isReserved(d))) {
          const composerDir = path.join(domainDir, composer);
          const composerBase = loadYamlFromPath(path.join(composerDir, `${COMPOSER_FILE}.yml`));
          if (composerBase) composers += 1;

          const files = listYamlFiles(composerDir, { stripExtension: false })
            .filter((f) => !isReserved(f));

          for (const file of files) {
            const resolved = this.#resolvePiece(path.join(composerDir, file), domain, composerBase, definitions);
            if (resolved) index.set(resolved.contentId, resolved.payload);
          }
        }
      }
    } catch {
      // A malformed root leaves whatever was indexed so far; lookups miss quietly.
    }

    this.#byContentId = index;
    this.logger?.info('surround.index.built', {
      pieces: index.size,
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
   * @returns {{ contentId: string, payload: Object }|null}
   * @private
   */
  #resolvePiece(filePath, domain, composerBase, definitions) {
    const doc = loadYamlFromPath(filePath);
    if (!doc || typeof doc !== 'object') return null;
    if (!doc.surround || !doc.match?.contentId) return null;

    const definition = definitions.get(doc.surround);
    if (!definition) return null;

    return {
      contentId: doc.match.contentId,
      payload: {
        id: doc.surround,
        definition: { regions: definition.regions, collapse: definition.collapse },
        piece: doc.piece || {},
        movements: doc.movements || [],
        cues: doc.cues || [],
        facts: doc.facts || [],
        // Piece-level `composer:` overrides the shared _composer.yml, key by key.
        composer: deepMerge(composerBase || {}, doc.composer || {}),
        assetBase: `surround/${domain}`
      }
    };
  }
}

export default SurroundStore;
