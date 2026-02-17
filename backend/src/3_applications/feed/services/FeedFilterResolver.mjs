// backend/src/3_applications/feed/services/FeedFilterResolver.mjs
/**
 * FeedFilterResolver
 *
 * 4-layer resolution chain for feed filter expressions.
 * Modeled after ContentIdResolver — parses "prefix:rest" compound IDs
 * into typed filter results.
 *
 * Layer 1: Tier match (wire, library, scrapbook, compass)
 * Layer 2: Source type match (reddit, youtube, etc.)
 * Layer 3: Query name match (exact, from query config filenames)
 * Layer 4: Alias (configurable shortcut map)
 *
 * @module applications/feed/services
 */

const TIER_NAMES = new Set(['wire', 'library', 'scrapbook', 'compass']);

export class FeedFilterResolver {
  #sourceTypes;
  #queryNames;
  #aliases;

  /**
   * @param {Object} options
   * @param {string[]} options.sourceTypes - Registered adapter sourceType values (e.g. ['reddit', 'youtube'])
   * @param {string[]} options.queryNames - Query config filenames without .yml (e.g. ['scripture-bom'])
   * @param {string[]} [options.builtinTypes] - Built-in source types not registered as adapters (e.g. ['freshrss', 'headlines', 'entropy'])
   * @param {Object<string, string>} [options.aliases] - Shortcut map (e.g. { photos: 'immich' })
   */
  constructor({ sourceTypes = [], queryNames = [], aliases = {}, builtinTypes = [] } = {}) {
    this.#sourceTypes = new Set([...sourceTypes, ...builtinTypes]);
    this.#queryNames = new Set(queryNames);
    this.#aliases = aliases;
  }

  /**
   * Resolve a filter expression to a typed result.
   *
   * @param {string} expression - e.g. "reddit:worldnews,usnews", "compass", "scripture-bom"
   * @returns {{ type: 'tier', tier: string }
   *         | { type: 'source', sourceType: string, subsources: string[]|null }
   *         | { type: 'query', queryName: string }
   *         | null}
   */
  resolve(expression) {
    if (!expression) return null;

    const colonIdx = expression.indexOf(':');
    const prefix = (colonIdx === -1 ? expression : expression.slice(0, colonIdx)).toLowerCase().trim();
    const rest = colonIdx === -1 ? null : expression.slice(colonIdx + 1).trim();
    const subsources = rest ? rest.split(',').map(s => s.trim()).filter(Boolean) : null;

    // Layer 1: Tier match
    if (TIER_NAMES.has(prefix)) {
      return { type: 'tier', tier: prefix };
    }

    // Layer 2: Source type match
    if (this.#sourceTypes.has(prefix)) {
      return { type: 'source', sourceType: prefix, subsources };
    }

    // Layer 3: Query name match (exact)
    if (this.#queryNames.has(prefix)) {
      return { type: 'query', queryName: prefix };
    }

    // Layer 4: Alias — resolve shortcut to target, then classify
    // Check order matches Layer 2/3 precedence: source type before query name.
    // Unregistered targets are treated authoritatively as source types.
    if (this.#aliases[prefix]) {
      const target = this.#aliases[prefix];
      if (this.#sourceTypes.has(target)) {
        return { type: 'source', sourceType: target, subsources };
      }
      if (this.#queryNames.has(target)) {
        return { type: 'query', queryName: target };
      }
      // Alias target not registered — treat authoritatively as source type
      return { type: 'source', sourceType: target, subsources };
    }

    return null;
  }
}
