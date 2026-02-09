// backend/src/1_adapters/content/filesystem/FilesystemDriver.mjs

/**
 * FilesystemDriver — Generalized driver for filesystem-based content.
 *
 * Supports three modes via content_format:
 *   - 'singalong'  — Participatory sing-along content (hymns, primary songs)
 *   - 'readalong'  — Follow-along narrated content (scripture, talks, poetry)
 *   - null/generic  — Plain filesystem media (audio/video files)
 *
 * Each instance represents one named source (e.g., "hymns", "scripture", "media").
 */
export class FilesystemDriver {
  #instanceName;
  #contentFormat;
  #dataPath;
  #mediaPath;
  #mediaPathMap;
  #path;

  /**
   * @param {Object} config
   * @param {string} config.instanceName - Instance name (used as source identifier)
   * @param {string|null} [config.content_format] - Content format: 'singalong', 'readalong', or null
   * @param {string} [config.data_path] - Path to content data (YAML) files
   * @param {string} [config.media_path] - Path to media (audio/video) files
   * @param {Object} [config.media_path_map] - Per-collection media path overrides
   * @param {string} [config.path] - Generic mode: single path for both data and media
   */
  constructor(config) {
    this.#instanceName = config.instanceName;
    this.#contentFormat = config.content_format || null;
    this.#dataPath = config.data_path || null;
    this.#mediaPath = config.media_path || null;
    this.#mediaPathMap = config.media_path_map || {};
    this.#path = config.path || null;
  }

  /** Source name for registry identification */
  get source() { return this.#instanceName; }

  /** Content format for frontend dispatch */
  get contentFormat() { return this.#contentFormat; }

  /** Data path root */
  get dataPath() { return this.#dataPath; }

  /** Media path root */
  get mediaPath() { return this.#mediaPath; }

  /** Per-collection media path overrides */
  get mediaPathMap() { return this.#mediaPathMap; }

  /**
   * Build file paths for a given localId.
   * @param {string} localId - Content-local ID (e.g., "hymn/0166-abide-with-me")
   * @returns {{ dataPath: string, mediaDir: string, mediaPathMap: Object }}
   */
  buildPaths(localId) {
    if (this.#dataPath) {
      // Extract collection from localId for media path map lookup
      const slashIdx = localId.indexOf('/');
      const collection = slashIdx >= 0 ? localId.slice(0, slashIdx) : null;
      const collectionMediaPath = collection ? this.#mediaPathMap[collection] : null;

      return {
        dataPath: `${this.#dataPath}/${localId}`,
        mediaDir: collectionMediaPath || this.#mediaPath,
        mediaPathMap: this.#mediaPathMap,
      };
    }
    return {
      dataPath: `${this.#path}/${localId}`,
      mediaDir: this.#path,
    };
  }
}
