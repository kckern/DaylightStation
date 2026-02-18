// backend/src/3_applications/feed/services/SourceResolver.mjs
/**
 * SourceResolver
 *
 * Builds instance (vendor alias) and content type maps from adapter list.
 * Resolves config source keys to adapters — vendor alias first, content type second.
 *
 * @module applications/feed/services
 */

export class SourceResolver {
  #instanceMap;
  #contentMap;

  /**
   * @param {Array<{sourceType: string, provides: string[]}>} adapters
   */
  constructor(adapters) {
    this.#instanceMap = new Map();
    this.#contentMap = new Map();

    for (const adapter of adapters) {
      this.#instanceMap.set(adapter.sourceType, adapter);

      for (const ct of adapter.provides) {
        if (!this.#contentMap.has(ct)) this.#contentMap.set(ct, []);
        this.#contentMap.get(ct).push(adapter);
      }
    }
  }

  /**
   * Resolve a config key to adapter(s).
   * 1. Try as vendor alias → single adapter
   * 2. Try as content type → all adapters providing that type
   * 3. Not found → empty array
   *
   * @param {string} key
   * @returns {Array<{sourceType: string, provides: string[]}>}
   */
  resolve(key) {
    const instance = this.#instanceMap.get(key);
    if (instance) return [instance];

    const byContent = this.#contentMap.get(key);
    if (byContent) return [...byContent];

    return [];
  }

  getInstanceMap() { return new Map(this.#instanceMap); }
  getContentMap() { return new Map(this.#contentMap); }
}
