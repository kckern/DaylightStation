// backend/src/3_applications/content/ContentIdResolver.mjs

/**
 * 5-layer content ID resolution chain.
 *
 * Layer 1: Exact source match (e.g., "plex:457385" → PlexAdapter)
 * Layer 2: Prefix match via registry (e.g., registered prefixes with transforms)
 * Layer 3: System alias (e.g., "hymn:166" → "singalong:hymn/166")
 * Layer 4a: No colon → check bareNameMap (discovered list names)
 * Layer 4b: No colon → default to media adapter
 * Layer 5: Household alias (e.g., "music:" → "plex:12345")
 * Layer 6: Empty-rest fallback → check bareNameMap (e.g., "fhe:" → "menu:fhe")
 */
export class ContentIdResolver {
  #registry;
  #systemAliases;
  #householdAliases;
  #bareNameMap;

  /**
   * @param {import('../../2_domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} registry
   * @param {Object} options
   * @param {Object<string, string>} [options.systemAliases] - e.g., { hymn: 'singalong:hymn' }
   * @param {Object<string, string>} [options.householdAliases] - e.g., { music: 'plex:12345' }
   * @param {Object<string, string>} [options.bareNameMap] - e.g., { fhe: 'menu' } for Layer 4a
   */
  constructor(registry, { systemAliases = {}, householdAliases = {}, bareNameMap = {} } = {}) {
    this.#registry = registry;
    this.#systemAliases = systemAliases;
    this.#householdAliases = householdAliases;
    this.#bareNameMap = bareNameMap;
  }

  /**
   * Resolve a compound content ID to source + localId + adapter.
   * @param {string} compoundId - e.g., "plex:457385", "hymn:166", "sfx/intro"
   * @returns {{ source: string, localId: string, adapter: any } | null}
   */
  resolve(compoundId) {
    if (!compoundId) return null;

    // Normalize space-after-colon YAML quirk
    const normalized = compoundId.replace(/^(\w+):\s+/, '$1:').trim();

    // Split on first colon
    const colonIdx = normalized.indexOf(':');
    if (colonIdx === -1) {
      // Layer 4a: Check bareNameMap (discovered list names: menu, program, watchlist)
      const mappedPrefix = this.#bareNameMap[normalized];
      if (mappedPrefix) {
        return this.resolve(`${mappedPrefix}:${normalized}`);
      }
      // Layer 4b: Default to media (original behavior)
      const adapter = this.#registry.get('media');
      return adapter ? { source: 'media', localId: normalized, adapter } : null;
    }

    const prefix = normalized.slice(0, colonIdx);
    const rest = normalized.slice(colonIdx + 1).trim();

    // Layer 1: Exact source match
    const exactAdapter = this.#registry.get(prefix);
    if (exactAdapter) {
      return { source: prefix, localId: rest, adapter: exactAdapter };
    }

    // Layer 2: Registry prefix match (handles legacy prefixes with transforms)
    const prefixResult = this.#registry.resolveFromPrefix(prefix, rest);
    if (prefixResult) {
      return { source: prefixResult.adapter.source, localId: prefixResult.localId, adapter: prefixResult.adapter };
    }

    // Layer 3: System alias
    if (this.#systemAliases[prefix]) {
      const aliasTarget = this.#systemAliases[prefix];
      const aliasColonIdx = aliasTarget.indexOf(':');
      if (aliasColonIdx !== -1) {
        const aliasSource = aliasTarget.slice(0, aliasColonIdx);
        const aliasPath = aliasTarget.slice(aliasColonIdx + 1);
        const adapter = this.#registry.get(aliasSource);
        if (adapter) {
          const localId = aliasPath && rest ? `${aliasPath}/${rest}` : (rest || aliasPath);
          return { source: aliasSource, localId, adapter };
        }
      }
    }

    // Layer 5: Household alias
    if (this.#householdAliases[prefix]) {
      const aliasTarget = this.#householdAliases[prefix];
      const aliasColonIdx = aliasTarget.indexOf(':');
      if (aliasColonIdx !== -1) {
        const aliasSource = aliasTarget.slice(0, aliasColonIdx);
        const aliasLocalId = aliasTarget.slice(aliasColonIdx + 1);
        const adapter = this.#registry.get(aliasSource);
        if (adapter) {
          return { source: aliasSource, localId: rest || aliasLocalId, adapter };
        }
      }
    }

    // Layer 6: Empty-rest fallback — when "fhe:" arrives (parseActionRouteId adds colon),
    // strip the colon and try bare name resolution via Layer 4a.
    if (rest === '' && this.#bareNameMap[prefix]) {
      return this.resolve(prefix);
    }

    return null;
  }
}
