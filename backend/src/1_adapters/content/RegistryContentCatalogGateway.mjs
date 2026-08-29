import { resolveFormat } from '#domains/content/utils/resolveFormat.mjs';
import { IContentCatalogGateway, assertContentCatalogGateway } from '#apps/content/ports/IContentCatalogGateway.mjs';

const PERMANENT_PLAYBACK_FAILURES = new Set(['metadata-missing', 'non-playable-type', 'audio-key-missing']);

function publicResolution(resolved) {
  return resolved?.adapter
    ? { source: resolved.adapter.source || resolved.source, localId: resolved.localId }
    : null;
}

function derivedCapabilities(item, source) {
  if (typeof source?.getCapabilities === 'function') return source.getCapabilities(item) || [];
  const result = [];
  if (item?.mediaUrl) result.push('playable');
  if (item?.thumbnail || item?.imageUrl) result.push('displayable');
  const listable = item?.items || item?.itemType === 'container';
  if (listable) result.push('listable');
  if (listable && typeof source?.resolvePlayables === 'function') result.push('queueable');
  if (item?.contentUrl || item?.format) result.push('readable');
  return result;
}

/**
 * Translate heterogeneous provider sibling records into the stable
 * application-facing sibling shape. Provider aliases belong in this
 * anti-corruption adapter, not in SiblingsService.
 */
function siblingItem(item, sourceOverride = null) {
  const source = sourceOverride || item.source || item.id?.split(':')[0] || null;
  const type = item.metadata?.type || item.type || item.itemType || null;
  const thumbnail = item.thumbnail || item.image || item.imageUrl || null;
  const parentTitle = item.metadata?.parentTitle ?? item.parentTitle ?? null;
  const grandparentTitle = item.metadata?.grandparentTitle ?? item.grandparentTitle ?? null;
  const libraryTitle = item.metadata?.librarySectionTitle ?? item.librarySectionTitle ?? null;
  const childCount = item.metadata?.childCount ?? item.metadata?.leafCount ?? item.childCount ?? null;
  const isContainer = item.itemType === 'container' || item.isContainer || item.metadata?.type === 'container';
  const itemIndex = item.metadata?.itemIndex ?? item.itemIndex ?? item.index ?? null;
  const number = item.metadata?.number ?? null;

  return {
    id: item.id,
    title: item.title,
    source,
    type,
    thumbnail,
    parentTitle,
    grandparentTitle,
    libraryTitle,
    childCount,
    isContainer,
    ...(itemIndex != null && { itemIndex }),
    ...(number != null && { number }),
    ...(item.group && { group: item.group })
  };
}

/** Anti-corruption adapter around ContentSourceRegistry and its source plugins. */
export class RegistryContentCatalogGateway extends IContentCatalogGateway {
  constructor({ registry, isSearchable = null, prefixAliases = {}, logger = console }) {
    super();
    if (!registry) throw new Error('RegistryContentCatalogGateway requires registry');
    this.registry = registry;
    this.isSearchable = isSearchable;
    this.prefixAliases = prefixAliases;
    this.logger = logger;
    assertContentCatalogGateway(this);
  }

  resolve(contentId) { return publicResolution(this.registry.resolve?.(contentId)); }

  resolveSource(source, localId = '') {
    const exact = this.registry.get(source);
    if (exact) return { source, localId };
    return publicResolution(this.registry.resolveFromPrefix?.(source, localId));
  }

  hasSource(source) { return Boolean(this.registry.get(source)); }
  sourceNames() { return this.registry.list?.() || [...(this.registry.adapters?.keys?.() || [])]; }
  categories() { return this.registry.getCategories?.() || []; }
  providers() { return this.registry.getProviders?.() || []; }
  sourcesFor(selector) { return (this.registry.resolveSource?.(selector) || []).map((source) => source.source); }
  sourcesByCategory(category) { return (this.registry.getByCategory?.(category) || []).map((source) => source.source); }

  /**
   * Resolve a query selector without exposing registry entries to the application.
   * Explicit kinds preserve alias configuration semantics; auto preserves the
   * historical exact-source, provider, category precedence.
   */
  resolveQueryScope(selector, kind = 'auto') {
    const exact = () => this.registry.get(selector) ? [selector] : [];
    const provider = () => (this.registry.getByProvider?.(selector) || []).map((source) => source.source);
    const category = () => (this.registry.getByCategory?.(selector) || []).map((source) => source.source);

    if (kind === 'source') return { kind: 'source', sources: exact() };
    if (kind === 'provider') return { kind: 'provider', sources: provider() };
    if (kind === 'category') return { kind: 'category', sources: category() };

    const sourceMatches = exact();
    if (sourceMatches.length > 0) return { kind: 'source', sources: sourceMatches };
    const providerMatches = provider();
    if (providerMatches.length > 0) return { kind: 'provider', sources: providerMatches };
    const categoryMatches = category();
    if (categoryMatches.length > 0) return { kind: 'category', sources: categoryMatches };
    return { kind: null, sources: [] };
  }

  parseDirectReference(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    const explicit = trimmed.match(/^([a-z]+):(.+)$/i);
    if (explicit) {
      const prefix = explicit[1].toLowerCase();
      const localId = explicit[2];
      const legacy = this.prefixAliases[prefix];
      if (legacy) {
        const [source, category] = legacy.split(':');
        return { source, id: `${category}/${localId}` };
      }
      return { source: prefix, id: localId };
    }
    if (/^\d+$/.test(trimmed)) return { source: 'plex', id: trimmed };
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
      return { source: 'immich', id: trimmed };
    }
    return null;
  }

  #source(resolution) {
    if (!resolution) return null;
    return this.registry.get(resolution.source)
      || this.registry.resolveFromPrefix?.(resolution.source, resolution.localId)?.adapter
      || null;
  }

  async getItem(resolution, contentRef = null) {
    const source = this.#source(resolution);
    if (typeof source?.getItem !== 'function') return null;
    return source.getItem(contentRef ?? resolution.localId);
  }

  async getMetadata(resolution, contentRef = null) {
    const source = this.#source(resolution);
    if (typeof source?.getMetadata !== 'function') return null;
    return source.getMetadata(contentRef ?? resolution.localId);
  }

  async getThumbnailUrl(resolution) {
    const source = this.#source(resolution);
    return typeof source?.getThumbnailUrl === 'function' ? source.getThumbnailUrl(resolution.localId) : null;
  }

  capabilities(item, resolution) { return derivedCapabilities(item, this.#source(resolution)); }
  supports(resolution, capability) { return typeof this.#source(resolution)?.[capability] === 'function'; }

  describeItem(item, resolution, session = null) {
    const source = this.#source(resolution);
    return {
      format: resolveFormat(item, source),
      source: source?.source || resolution?.source || null,
      clientIdentifier: typeof source?.resolveClientIdentifier === 'function'
        ? source.resolveClientIdentifier(session)
        : null,
    };
  }

  async getList(resolution, contentRef = null) {
    const source = this.#source(resolution);
    if (typeof source?.getList !== 'function') return [];
    return source.getList(contentRef ?? resolution.localId);
  }

  async resolvePlayables(resolution, contentRef = null) {
    const source = this.#source(resolution);
    if (typeof source?.resolvePlayables !== 'function') return null;
    return source.resolvePlayables(contentRef ?? resolution.localId);
  }

  async resolveLaunchables(resolution, contentRef = null) {
    const source = this.#source(resolution);
    if (typeof source?.resolveLaunchables !== 'function') return null;
    return source.resolveLaunchables(contentRef ?? resolution.localId);
  }

  async getContainerInfo(resolution, contentRef = null) {
    const source = this.#source(resolution);
    return typeof source?.getContainerInfo === 'function'
      ? source.getContainerInfo(contentRef ?? resolution.localId)
      : null;
  }

  async resolveSiblings(resolution, contentRef = null) {
    const source = this.#source(resolution);
    if (typeof source?.resolveSiblings !== 'function') return null;
    const result = await source.resolveSiblings(contentRef ?? resolution.localId);
    if (result === null) return null;
    return {
      ...result,
      items: (result.items || []).map((item) => siblingItem(item, result.sourceOverride))
    };
  }

  async progressNamespace(resolution, contentRef = null) {
    const source = this.#source(resolution);
    return typeof source?.getStoragePath === 'function'
      ? source.getStoragePath(contentRef ?? resolution.localId)
      : resolution?.source;
  }

  async listNamespace(listId) {
    const source = this.registry.adapters?.get?.('watchlist') || this.registry.get?.('watchlist');
    return typeof source?.getListNamespace === 'function' ? source.getListNamespace(listId) : null;
  }

  async playbackManifest(sourceName, id, options) {
    const source = this.registry.get(sourceName);
    if (!source) return { kind: 'unconfigured' };
    if (typeof source.getMediaUrl !== 'function') return { kind: 'unsupported' };
    const result = await source.getMediaUrl(id, options);
    return result?.url ? { kind: 'found', url: result.url } : { kind: 'not_found', reason: result?.reason };
  }

  async preparePlayback(resolution, item, options) {
    const source = this.#source(resolution);
    // `not plex` is a retained public compatibility value. Keep that legacy
    // provider vocabulary at the adapter edge; application orchestration only
    // propagates the reason supplied by its semantic content port.
    if (typeof source?.loadMediaUrl !== 'function') return { kind: 'unsupported', reason: 'not plex' };
    const result = await source.loadMediaUrl(item, options);
    if (result?.url) return { kind: 'ready', url: result.url };
    const reason = result?.reason ?? 'loadMediaUrl returned null';
    return { kind: 'failed', reason, permanent: PERMANENT_PLAYBACK_FAILURES.has(reason) };
  }

  searchCapabilities(sourceName) {
    return this.registry.get(sourceName)?.getSearchCapabilities?.() ?? { canonical: [], specific: [] };
  }

  queryMappings(sourceName) { return this.registry.get(sourceName)?.getQueryMappings?.() ?? {}; }
  containerAliases(sourceName) { return this.registry.get(sourceName)?.getContainerAliases?.() ?? {}; }
  containerType(resolution, contentRef = null) {
    const source = this.#source(resolution);
    return typeof source?.getContainerType === 'function'
      ? source.getContainerType(contentRef ?? resolution.localId)
      : 'watchlist';
  }
  isSourceSearchable(sourceName) {
    const source = this.registry.get(sourceName);
    return this.isSearchable ? this.isSearchable(source) : typeof source?.search === 'function';
  }
  async search(sourceName, query) { return this.registry.get(sourceName).search(query); }
  async listSource(sourceName, query) { return this.registry.get(sourceName).getList(query); }

  async findAlternates(contentId) {
    const resolved = this.registry.resolve?.(contentId);
    const source = resolved?.adapter;
    if (typeof source?.resolveFilePath !== 'function') return [];
    const filePath = source.resolveFilePath(resolved.localId);
    if (!filePath) return [];
    const alternates = [];
    for (const sourceName of this.sourceNames()) {
      const candidate = this.registry.get(sourceName);
      if (!candidate || candidate === source || typeof candidate.localIdForFilePath !== 'function') continue;
      const localId = candidate.localIdForFilePath(filePath);
      if (!localId) continue;
      const prefix = candidate.prefixes?.[0]?.prefix || candidate.source;
      const altId = `${prefix}:${localId}`;
      if (altId === contentId) continue;
      try {
        const item = await candidate.getItem(localId);
        if (item) alternates.push({
          contentId: altId,
          source: prefix,
          title: item.title || null,
          capabilities: derivedCapabilities(item, candidate),
        });
      } catch (error) {
        this.logger.warn?.('alternates.candidate_failed', { contentId, candidate: prefix, error: error.message });
      }
    }
    return alternates;
  }
}

export default RegistryContentCatalogGateway;
