// backend/src/3_applications/content/SavedQueryService.mjs

/**
 * Application-layer service for managing saved query definitions.
 * Reads/writes query YAML files via injected I/O functions (no direct file access).
 *
 * Query definitions are YAML files stored in the queries/ subdirectory
 * of the lists config path. Each defines a type (e.g., 'freshvideo')
 * and type-specific parameters (e.g., sources: []).
 */
export class SavedQueryService {
  #readQuery;
  #listQueries;
  #writeQuery;
  #deleteQuery;

  /**
   * @param {Object} deps
   * @param {(name: string) => Object|null} deps.readQuery - Read a query definition by name
   * @param {() => string[]} [deps.listQueries] - List all query names
   * @param {(name: string, data: Object) => void} [deps.writeQuery] - Write a query definition
   * @param {(name: string) => void} [deps.deleteQuery] - Delete a query definition
   */
  constructor({ readQuery, listQueries, writeQuery, deleteQuery } = {}) {
    this.#readQuery = readQuery;
    this.#listQueries = listQueries || null;
    this.#writeQuery = writeQuery || null;
    this.#deleteQuery = deleteQuery || null;
  }

  /**
   * Get a normalized query definition.
   * @param {string} name - Query name (e.g., 'dailynews')
   * @returns {{ title: string, source: string, filters: Object } | null}
   */
  getQuery(name) {
    const raw = this.#readQuery(name);
    if (!raw) return null;

    return {
      title: raw.title || name,
      source: raw.type,
      filters: {
        sources: raw.sources || [],
      },
      ...(raw.sort != null && { sort: raw.sort }),
      ...(raw.take != null && { take: raw.take }),
    };
  }

  /**
   * List all saved query names.
   * @returns {string[]}
   */
  listQueries() {
    if (!this.#listQueries) return [];
    return this.#listQueries();
  }

  /**
   * Save a query definition.
   * @param {string} name - Query name
   * @param {Object} data - Query definition (type, sources, etc.)
   */
  saveQuery(name, data) {
    if (!this.#writeQuery) {
      throw new Error('SavedQueryService: write not configured');
    }
    this.#writeQuery(name, data);
  }

  /**
   * Delete a query definition.
   * @param {string} name - Query name
   */
  deleteQuery(name) {
    if (!this.#deleteQuery) {
      throw new Error('SavedQueryService: delete not configured');
    }
    this.#deleteQuery(name);
  }
}
