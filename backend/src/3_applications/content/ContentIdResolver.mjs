// backend/src/3_applications/content/ContentIdResolver.mjs

/**
 * 5-layer content ID resolution chain.
 *
 * Layer 1: Exact source match (e.g., "plex:457385" → PlexAdapter)
 * Layer 2: Prefix match via registry (e.g., registered prefixes with transforms)
 * Layer 3: System alias (e.g., "hymn:166" → "singalong:hymn/166")
 * Layer 4: No colon → default to media adapter
 * Layer 5: Household alias (e.g., "music:" → "plex:12345")
 */
export class ContentIdResolver {
  #registry;
  #systemAliases;
  #householdAliases;

  /**
   * @param {import('../../2_domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} registry
   * @param {Object} options
   * @param {Object<string, string>} [options.systemAliases] - e.g., { hymn: 'singalong:hymn' }
   * @param {Object<string, string>} [options.householdAliases] - e.g., { music: 'plex:12345' }
   */
  constructor(registry, { systemAliases = {}, householdAliases = {} } = {}) {
    this.#registry = registry;
    this.#systemAliases = systemAliases;
    this.#householdAliases = householdAliases;
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
      // Layer 4: No colon → default to media
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

    return null;
  }
}
