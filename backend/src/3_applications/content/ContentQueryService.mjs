// backend/src/3_applications/content/ContentQueryService.mjs

import { ItemSelectionService, RelevanceScoringService } from '#domains/content/index.mjs';
import { IContentQueryPort } from '../feed/ports/IContentQueryPort.mjs';

/**
 * Race a promise against a timeout. A non-positive `ms` disables the timeout
 * (returns the promise unchanged). On timeout the returned promise rejects with
 * an Error whose message contains the adapter label and "timeout".
 */
/**
 * Application service for orchestrating content queries across multiple sources.
 * Handles canonical key translation, result merging, and capability filtering.
 */
export class ContentQueryService extends IContentQueryPort {
  #contentCatalog;
  #mediaProgressMemory;
  #logger;
  #aliasResolver;
  #adapterTimeoutMs;
  #sourceTimeoutsMs;
  #deadline;

  /**
   * @param {Object} deps
   * @param {Object} deps.contentCatalog
   * @param {import('#apps/content/ports/IMediaProgressMemory.mjs').IMediaProgressMemory} [deps.mediaProgressMemory]
  * @param {Object<string, string>} [deps.prefixAliases] - Map of prefix aliases to canonical format (e.g., { hymn: 'singalong:hymn' })
   * @param {Object} [deps.logger] - Logger instance for performance and debug logging
   * @param {import('./services/ContentQueryAliasResolver.mjs').ContentQueryAliasResolver} [deps.aliasResolver] - Optional alias resolver for prefix-based queries
   * @param {number} [deps.adapterTimeoutMs=3000] - Default per-adapter search timeout
   * @param {Object<string, number>} [deps.sourceTimeoutsMs] - Per-source timeout overrides (e.g., { abs: 6000 })
   */
  constructor({ contentCatalog, mediaProgressMemory = null, prefixAliases = {}, logger = console, aliasResolver = null, adapterTimeoutMs = 3000, sourceTimeoutsMs = {}, deadline = { run: work => work } }) {
    super();
    if (!contentCatalog?.search) throw new Error('ContentQueryService requires contentCatalog');
    this.#contentCatalog = contentCatalog;
    this.#mediaProgressMemory = mediaProgressMemory;
    this.#logger = logger;
    this.#aliasResolver = aliasResolver;
    this.#adapterTimeoutMs = adapterTimeoutMs;
    this.#sourceTimeoutsMs = sourceTimeoutsMs || {};
    this.#deadline = deadline;
  }

  #within(work, ms, label) {
    if (!ms || ms <= 0) return work;
    return this.#deadline.run(work, { timeoutMs: ms, message: `${label} timeout after ${ms}ms` });
  }

  /**
   * Resolve the search timeout budget for a source.
   * Per-source overrides (slow local-scan sources like abs/singalong) win over
   * the default.
   * @param {string} source
   * @returns {number} timeout in ms
   */
  #timeoutFor(source) {
    const override = this.#sourceTimeoutsMs[source];
    return typeof override === 'number' ? override : this.#adapterTimeoutMs;
  }

  /**
   * Parse a content query string to extract prefix and search term.
   * Supports "prefix:term" format (e.g., "music:beethoven", "photos:vacation").
   *
   * @param {string} query - Query string to parse
   * @returns {{prefix: string|null, term: string}} Parsed prefix and term
   * @private
   */
  #parseContentQuery(query) {
    if (!query || typeof query !== 'string') {
      return { prefix: null, term: query || '' };
    }

    const match = query.match(/^(\w+):(.+)$/);
    if (match) {
      return { prefix: match[1].toLowerCase(), term: match[2] };
    }
    return { prefix: null, term: query };
  }

  /**
   * Search across multiple content sources.
   * Supports direct ID lookup (explicit "plex:123" or implicit "123") with text search fallback.
   * ID lookup and text search run in parallel for speed.
   *
   * When an aliasResolver is configured, supports prefix-based queries (e.g., "music:beethoven")
   * that resolve to specific sources with content gatekeepers.
   *
   * @param {Object} query - Normalized query object
   * @returns {Promise<{items: Array, total: number, sources: string[], warnings?: Array, _perf?: Object}>}
   */
  async search(query) {
    const searchStart = performance.now();
    const perf = {
      totalMs: 0,
      adapters: {},
      idLookupMs: null,
      mergeMs: 0,
    };

    // Parse prefix from query text for alias resolution
    const { prefix, term } = this.#parseContentQuery(query.text);

    // Resolve sources and gatekeeper through alias system if available
    let sources;
    let gatekeeper = null;

    if (this.#aliasResolver && prefix) {
      const resolved = this.#aliasResolver.resolveContentQuery(prefix);

      // Use resolved sources if available, otherwise fall back to registry
      if (resolved.sources?.length > 0) {
        sources = resolved.sources.filter((source) => this.#contentCatalog.hasSource(source));
      } else {
        sources = this.#contentCatalog.sourcesFor(query.source || prefix);
      }

      gatekeeper = resolved.gatekeeper;

      // Update query text to use just the term (without prefix)
      query = { ...query, text: term };
    } else {
      sources = this.#contentCatalog.sourcesFor(query.source);
    }

    const warnings = [];

    // Check if query.text looks like a direct ID
    const idMatch = this.#contentCatalog.parseDirectReference(query.text);

    // Run ID lookup and text search in parallel
    const [idResult, searchResults] = await Promise.all([
      // Direct ID lookup (if text looks like an ID)
      (async () => {
        if (!idMatch) return null;
        const start = performance.now();
        const result = await this.#lookupById(idMatch.source, idMatch.id, warnings);
        perf.idLookupMs = Math.round(performance.now() - start);
        return result;
      })(),

      // Standard text search across adapters
      Promise.all(
        sources.map(async (source) => {
          const adapterStart = performance.now();
          try {
            if (!this.#canHandle(source, query)) {
              perf.adapters[source] = { ms: 0, skipped: true };
              return null;
            }

            const translated = this.#translateQuery(source, query);
            const result = await this.#within(this.#contentCatalog.search(source, translated), this.#timeoutFor(source), source);
            const ms = Math.round(performance.now() - adapterStart);
            perf.adapters[source] = {
              ms,
              count: result?.items?.length ?? 0,
            };
            return { source, result };
          } catch (error) {
            const ms = Math.round(performance.now() - adapterStart);
            perf.adapters[source] = {
              ms,
              error: error.message,
            };
            warnings.push({
              source,
              error: error.message,
            });
            return null;
          }
        })
      )
    ]);

    // Filter out null results from search
    const results = searchResults.filter(Boolean);

    // Merge results with ID match leading
    const mergeStart = performance.now();
    let merged = this.#mergeResultsWithIdMatch(idResult, results, query, warnings);

    // Apply gatekeeper filter from alias resolution (after merge to include ID matches)
    if (gatekeeper && merged.items) {
      const filteredItems = merged.items.filter(gatekeeper);
      merged = {
        ...merged,
        items: filteredItems,
        total: filteredItems.length
      };
    }

    perf.mergeMs = Math.round(performance.now() - mergeStart);
    perf.totalMs = Math.round(performance.now() - searchStart);

    // Log performance summary
    const slowAdapters = Object.entries(perf.adapters)
      .filter(([, v]) => v.ms > 1000)
      .map(([k, v]) => `${k}:${v.ms}ms`)
      .join(', ');

    // Use appropriate log level based on performance
    const logData = {
      query: { text: query.text, source: query.source },
      totalMs: perf.totalMs,
      adapterCount: sources.length,
      resultCount: merged.items?.length ?? 0,
      slowAdapters: slowAdapters || null,
      perf,
    };

    if (perf.totalMs > 10000) {
      this.#logger.warn?.('content-query.search.slow', logData) ?? this.#logger.warn?.(logData);
    } else {
      this.#logger.info?.('content-query.search.perf', logData) ?? this.#logger.info?.(logData);
    }

    return { ...merged, _perf: perf };
  }

  /**
   * Stream search results as each adapter completes.
   * Yields events: 'pending' (initial), 'results' (per adapter), 'complete' (final).
   *
   * When an aliasResolver is configured, supports prefix-based queries (e.g., "music:beethoven")
   * that resolve to specific sources with content gatekeepers.
   *
   * @param {Object} query - Normalized query object
   * @yields {{event: string, ...data}}
   */
  async *searchStream(query) {
    const searchStart = performance.now();
    const warnings = [];

    // Parse prefix from query text (e.g., "music:beethoven" -> { prefix: 'music', term: 'beethoven' })
    const { prefix, term } = this.#parseContentQuery(query.text);

    // Resolve sources and gatekeeper through alias system if available
    let sources;
    let gatekeeper = null;
    let resolvedIntent = null;

    if (this.#aliasResolver && prefix) {
      const resolved = this.#aliasResolver.resolveContentQuery(prefix);
      resolvedIntent = resolved.intent;

      // Use resolved sources if available, otherwise fall back to registry
      if (resolved.sources?.length > 0) {
        sources = resolved.sources.filter((source) => this.#contentCatalog.hasSource(source));
      } else {
        sources = this.#contentCatalog.sourcesFor(query.source || prefix);
      }

      gatekeeper = resolved.gatekeeper;

      // Update query text to use just the term (without prefix)
      query = { ...query, text: term };
    } else {
      // Standard resolution through registry
      sources = this.#contentCatalog.sourcesFor(query.source);
    }

    const pending = new Set(sources);

    // Track emitted item ids so the same item is never streamed twice
    // (e.g. the files adapter surfaced duplicate itemIds from overlapping
    // media-prefix scans). Keyed per-source so distinct sources that happen
    // to share an id are not conflated.
    const emittedIds = new Set();

    // Yield initial pending state
    yield { event: 'pending', sources: [...pending], intent: resolvedIntent };

    // Per-source elapsed ms, whether the adapter resolved or failed. Skipped
    // adapters (never called, see #canHandle above) get no entry. Surfaced
    // on the completion log below so stragglers (RC3) are diagnosable from
    // prod logs instead of only the aggregate totalMs.
    const sourceTimings = {};

    // Create promises for all adapters
    const adapterPromises = sources.map(async (source) => {
      if (!this.#canHandle(source, query)) {
        return { source, result: null, skipped: true };
      }

      const startedAt = performance.now();
      try {
        const translated = this.#translateQuery(source, query);
        const result = await this.#within(this.#contentCatalog.search(source, translated), this.#timeoutFor(source), source);
        sourceTimings[source] = Math.round(performance.now() - startedAt);
        return { source, result, error: null };
      } catch (error) {
        sourceTimings[source] = Math.round(performance.now() - startedAt);
        warnings.push({ source, error: error.message });
        return { source, result: null, error };
      }
    });

    // Race all promises and yield results as they complete
    const remaining = [...adapterPromises];
    while (remaining.length > 0) {
      const winner = await Promise.race(
        remaining.map((p, i) => p.then(result => ({ result, index: i })))
      );

      // Remove completed promise
      remaining.splice(winner.index, 1);

      const { source, result, skipped, error } = winner.result;
      pending.delete(source);

      if (error) {
        yield { event: 'source_error', source, error: error.message, pending: [...pending] };
        continue;
      }
      if (skipped || !result?.items?.length) {
        continue;
      }

      // Apply gatekeeper filter from alias resolution
      let items = result.items;
      if (gatekeeper) {
        items = items.filter(gatekeeper);
      }

      // Apply capability filter if specified
      if (query.capability) {
        items = items.filter(item => this.#hasCapability(item, query.capability));
      }

      // Apply caller-declared media-type filters (see search() for shape).
      items = applyMediaTypeFilters(items, query);

      // Dedupe within the stream: drop items whose id was already emitted
      // by this adapter (cheap Set lookup; ids are stable compound ids).
      items = items.filter(item => {
        const key = `${source}|${item?.id}`;
        if (emittedIds.has(key)) return false;
        emittedIds.add(key);
        return true;
      });

      // Skip if all items filtered out
      if (items.length === 0) {
        continue;
      }

      // Annotate each item with its relevance score (same scoring the
      // non-streaming search() uses via RelevanceScoringService) so the
      // frontend can merge-sort batches as they arrive. Additive field —
      // the event shape is otherwise unchanged. Items within a batch are
      // pre-sorted by score for consumers that render batches as-is.
      //
      // A zero score means the item matched no part of the query. Streaming it
      // anyway is how a source that ignores the search term (returning its
      // newest N regardless) fills the result list with noise, so drop those
      // here rather than making every consumer re-derive the same judgement.
      items = items
        .map(item => ({ ...item, score: RelevanceScoringService.score(item, query.text) }))
        .filter(item => !query.text || item.score > 0)
        .sort((a, b) => b.score - a.score);

      // A batch can empty out entirely once non-matches are dropped; say
      // nothing rather than yielding an empty results event.
      if (items.length === 0) {
        continue;
      }

      yield {
        event: 'results',
        source,
        items,
        pending: [...pending]
      };
    }

    const totalMs = Math.round(performance.now() - searchStart);

    // Log performance
    const logData = {
      query: { text: query.text, source: query.source },
      totalMs,
      adapterCount: sources.length,
      sourceTimings,
      ...(resolvedIntent && { intent: resolvedIntent })
    };
    this.#logger.info?.('content-query.searchStream.complete', logData) ?? this.#logger.info?.(logData);

    yield { event: 'complete', totalMs, warnings: warnings.length > 0 ? warnings : undefined };
  }

  /**
   * Parse text to detect if it's a direct ID reference.
   *
   * NOTE: This method contains source-specific ID format knowledge as a
   * pragmatic tradeoff. Moving this to adapters would require significant
   * interface changes for minimal benefit. The ID formats (numeric for Plex,
   * UUID for Immich) are stable and unlikely to conflict with search terms.
   *
   * If this becomes problematic, adapters could implement:
   *   getIdPattern(): { pattern: RegExp, priority: number }
   *
   * Supports:
  * - Legacy prefix mapping (e.g., "hymn:123" → {source: 'singalong', id: 'hymn/123'})
   * - Explicit "source:id" format (e.g., "plex:456724", "immich:abc-123")
   * - Implicit all-digits → plex (e.g., "456724")
   * - Implicit UUID → immich (e.g., "ff940f1a-f5ea-4580-a517-dfc68413e215")
   *
   * @param {string} text - Search text to check
   * @returns {{source: string, id: string} | null}
   */
  /**
   * Public wrapper for testing legacy prefix mapping.
   * @param {string} text - Search text to check
   * @returns {{source: string, id: string} | null}
   */
  _parseIdFromTextPublic(text) {
    return this.#contentCatalog.parseDirectReference(text);
  }

  /**
   * Attempt direct ID lookup from a source.
   *
   * @param {string} source - Source name
   * @param {string} id - Local ID
   * @param {Array} warnings - Warnings array to append errors
   * @returns {Promise<Object | null>} Item if found, null otherwise
   */
  async #lookupById(source, id, warnings) {
    try {
      let resolution = this.#contentCatalog.resolveSource(source, id);
      if (!resolution) {
        // Try resolving by source name in case it's a provider name
        const sources = this.#contentCatalog.sourcesFor(source);
        if (sources.length === 0) return null;
        // Use first matching adapter
        return this.#lookupById(sources[0], id, warnings);
      }

      if (this.#contentCatalog.supports(resolution, 'getItem')) {
        const item = await this.#within(this.#contentCatalog.getItem(resolution, id), this.#timeoutFor(source), `${source} id-lookup`);
        if (item) {
          // matchReason is a public field (survives to the API response) so UIs
          // can label ID-pinned results; _idMatch is internal and stripped later.
          return { ...item, _idMatch: true, matchReason: 'id-lookup' };
        }
      }

      // Fallback: try to get item info via other means
      if (this.#contentCatalog.supports(resolution, 'getMetadata')) {
        const metadata = await this.#within(this.#contentCatalog.getMetadata(resolution, id), this.#timeoutFor(source), `${source} id-lookup`);
        if (metadata) {
          return {
            id: `${source}:${id}`,
            source,
            localId: id,
            title: metadata.title,
            thumbnail: metadata.thumbnail,
            metadata,
            _idMatch: true,
            matchReason: 'id-lookup'
          };
        }
      }

      return null;
    } catch (error) {
      // Silent failure - ID lookup is best-effort
      warnings.push({
        source,
        error: `ID lookup failed: ${error.message}`,
      });
      return null;
    }
  }

  /**
   * Merge search results with ID match leading, sorted by relevance.
   */
  #mergeResultsWithIdMatch(idResult, results, query, warnings) {
    let items = results.flatMap(r => r.result.items || []);

    // If we have an ID match, prepend it (avoiding duplicates)
    if (idResult) {
      const idMatchId = idResult.id;
      // Remove any duplicate from search results
      items = items.filter(item => item.id !== idMatchId);
      // Prepend the ID match
      items.unshift(idResult);
    }

    // Apply capability filter
    if (query.capability) {
      items = items.filter(item => this.#hasCapability(item, query.capability));
    }

    // Generic media-type filters (callers declare the policy):
    //   excludeMediaTypes: string[] — blocklist by item.mediaType / metadata.type
    //   includeMediaTypes: string[] — allowlist (anything outside is dropped)
    items = applyMediaTypeFilters(items, query);

    // Apply relevance-based sorting (unless random or explicit sort)
    if (query.sort === 'random') {
      const idMatch = items.find(i => i._idMatch);
      const rest = items.filter(i => !i._idMatch);
      items = idMatch ? [idMatch, ...this.#shuffle(rest)] : this.#shuffle(items);
    } else if (!query.sort || query.sort === 'relevance') {
      // Relevance floor. Adapters answer a text search with whatever they have
      // — some ignore the term entirely and return their newest N — so without
      // this, a query matching nothing still renders a full page of results and
      // "we found nothing" is indistinguishable from "here are your matches".
      // Only applies when there IS text to match against; an empty query is a
      // browse and every item legitimately belongs.
      if (query.text) {
        items = items.filter(item =>
          item._idMatch || RelevanceScoringService.matches(item, query.text)
        );
      }
      // Sort by match quality, with category breaking ties
      items = this.#sortByRelevance(items, query.text);
    }

    // Generic secondary ranking. Callers declare a list of weighted factors
    // applied AFTER the primary sort (preserves relevance order within ties).
    //   query.rank: { factors: [{ field, weight, normalize }] }
    //   field      — dotted path into the item, e.g. 'metadata.userRating'
    //   weight     — 0..1 contribution to the composite score
    //   normalize  — 'div:N' (value/N capped at 1) | 'log10:N' (log10(v+1)/log10(N+1) capped at 1)
    if (query.rank?.factors?.length > 0) {
      items = applyWeightedRank(items, query.rank.factors);
    }

    // Clean up internal flag
    items = items.map(({ _idMatch, ...item }) => item);

    // Apply pagination
    const skip = query.skip || 0;
    const take = query.take || items.length;
    const total = items.length;
    items = items.slice(skip, skip + take);

    const sources = [...new Set(items.map(i => i.source))];

    const result = { items, total, sources };
    if (warnings.length > 0) {
      result.warnings = warnings;
    }
    return result;
  }

  /**
   * Sort items by relevance score.
   * Delegates to domain RelevanceScoringService.
   * @param {Array} items
   * @param {string} [searchText]
   * @returns {Array}
   */
  #sortByRelevance(items, searchText) {
    return RelevanceScoringService.sortByRelevance(items, searchText);
  }

  /**
   * List containers from an alias (e.g., "playlists") across sources.
   *
   * @param {Object} query - Query with 'from' alias
   * @returns {Promise<{items: Array, total: number, sources: string[], picked?: Object}>}
   */
  async list(query) {
    const { from, source, pick } = query;
    const sources = this.#contentCatalog.sourcesFor(source);
    const results = [];
    const warnings = [];

    await Promise.all(
      sources.map(async (sourceName) => {
        try {
          const aliases = this.#contentCatalog.containerAliases(sourceName);
          const containerPath = aliases[from];

          if (!containerPath) return;

          // Pass full query with adapter-specific params, overriding alias with resolved path
          const listQuery = { ...query, from: containerPath };
          const items = await this.#contentCatalog.listSource(sourceName, listQuery);
          results.push({ source: sourceName, result: { items, total: items.length } });
        } catch (error) {
          warnings.push({
            source: sourceName,
            error: error.message,
          });
        }
      })
    );

    const merged = this.#mergeResults(results, query, warnings);

    // Handle pick=random
    if (pick === 'random' && merged.items.length > 0) {
      return this.#pickRandom(merged, query);
    }

    return merged;
  }

  /**
   * Pick a random container and return its contents.
   *
   * @param {Object} listResult - Result from list()
   * @param {Object} query - Original query for filtering contents
   * @returns {Promise<Object>}
   */
  async #pickRandom(listResult, query) {
    const containers = listResult.items.filter(i => i.itemType === 'container');
    if (containers.length === 0) {
      return { ...listResult, picked: null };
    }

    const picked = containers[Math.floor(Math.random() * containers.length)];
    const [source] = picked.id.split(':');
    const resolution = this.#contentCatalog.resolveSource(source, picked.id.replace(`${source}:`, ''));
    if (!resolution) {
      return { ...listResult, picked, items: [], total: 0 };
    }

    // Get contents of picked container
    const localId = picked.id.replace(`${source}:`, '');
    const contents = await this.#contentCatalog.getList(resolution, localId);

    // Apply filters to contents
    let filteredContents = contents;
    if (query.mediaType) {
      filteredContents = contents.filter(
        item => item.metadata?.type === query.mediaType || item.mediaType === query.mediaType
      );
    }

    return {
      from: query.from,
      picked: {
        id: picked.id,
        source: picked.source,
        title: picked.title,
      },
      sources: [picked.source],
      total: filteredContents.length,
      items: filteredContents,
    };
  }

  /**
   * Check if adapter can handle the query.
   */
  #canHandle(source, query) {
    const caps = this.#contentCatalog.searchCapabilities(source);
    const META_KEYS = ['source', 'take', 'skip', 'sort', 'withExif', 'withPeople'];
    const queryKeys = Object.keys(query).filter(k => !META_KEYS.includes(k));

    // Must support at least one query key (or query is empty = list all)
    if (queryKeys.length === 0) return true;

    return queryKeys.some(k =>
      caps.canonical?.includes(k) || caps.specific?.includes(k)
    );
  }

  /**
   * Translate canonical query keys to adapter-specific.
   */
  #translateQuery(source, query) {
    const mappings = this.#contentCatalog.queryMappings(source);
    const translated = {};

    for (const [key, value] of Object.entries(query)) {
      // Skip meta keys
      if (['source', 'capability'].includes(key)) continue;

      const mapping = mappings[key];
      if (mapping) {
        if (typeof mapping === 'string') {
          translated[mapping] = value;
        } else if (mapping.from && mapping.to && typeof value === 'object' && value.from !== undefined) {
          // Range mapping
          if (value.from) translated[mapping.from] = value.from;
          if (value.to) translated[mapping.to] = value.to;
        } else if (typeof mapping === 'object' && mapping.from) {
          // Range value as string "a..b"
          if (typeof value === 'string' && value.includes('..')) {
            const [from, to] = value.split('..');
            if (from) translated[mapping.from] = from;
            if (to) translated[mapping.to] = to;
          } else {
            translated[mapping.from] = value;
          }
        }
      } else {
        // Pass through unmapped keys
        translated[key] = value;
      }
    }

    return translated;
  }

  /**
   * Merge results from multiple adapters.
   */
  #mergeResults(results, query, warnings = []) {
    let items = results.flatMap(r => r.result.items || []);

    // Apply capability filter
    if (query.capability) {
      items = items.filter(item => this.#hasCapability(item, query.capability));
    }

    // Apply sort
    if (query.sort === 'random') {
      items = this.#shuffle(items);
    }

    // Apply pagination
    const skip = query.skip || 0;
    const take = query.take || items.length;
    const total = items.length;
    items = items.slice(skip, skip + take);

    const sources = [...new Set(items.map(i => i.source))];

    const result = { items, total, sources };
    if (warnings.length > 0) {
      result.warnings = warnings;
    }
    return result;
  }

  /**
   * Check if item has a capability.
   */
  #hasCapability(item, capability) {
    const capMap = {
      playable: () => typeof item.isPlayable === 'function' ? item.isPlayable() : !!item.mediaUrl,
      displayable: () => typeof item.isDisplayable === 'function' ? item.isDisplayable() : !!item.imageUrl,
      readable: () => typeof item.isReadable === 'function' ? item.isReadable() : !!item.contentUrl,
      listable: () => typeof item.isContainer === 'function' ? item.isContainer() : item.itemType === 'container',
    };
    return capMap[capability]?.() ?? false;
  }

  /**
   * Fisher-Yates shuffle.
   */
  #shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * Enrich items with watch state from mediaProgressMemory.
   * Optimized to resolve the progress namespace once and batch-load all progress.
   * Falls back to scanning all library files when source is offline.
   * @param {Array} items - Items to enrich
   * @param {string} source - Content source for progress namespace resolution
   * @param {string} [containerId] - Container ID for efficient namespace lookup
   * @returns {Promise<Array>} Enriched items
   */
  async #enrichWithWatchState(items, source, containerId = null) {
    if (!this.#mediaProgressMemory || items.length === 0) {
      return items;
    }

    // Resolve the namespace once from the container (not per-item) to avoid N API calls.
    let progressNamespace = source || 'default';
    let usesFallback = false;
    const lookupId = containerId || items[0]?.id;
    if (lookupId) {
      try {
        const resolution = this.#contentCatalog.resolveSource(source, lookupId);
        progressNamespace = await this.#contentCatalog.progressNamespace(resolution, lookupId);
      } catch {
        usesFallback = true;
      }
    }

    this.#logger.debug?.('content-query.watch-state.storage-path', {
      storagePath: progressNamespace,
      usesFallback,
    });

    // Load all progress for this namespace at once (1 repository read, not N).
    let allProgress = await this.#mediaProgressMemory.listProgress(progressNamespace);
    this.#logger.debug?.('content-query.watch-state.progress-loaded', { count: allProgress.length });

    // If no progress found and we're using fallback, scan all library files
    // This handles the case when the source is offline (e.g., Plex unreachable)
    if (allProgress.length === 0 && (usesFallback || progressNamespace === source)) {
      // Try loading across all namespaces owned by the source.
      if (typeof this.#mediaProgressMemory.listSourceProgress === 'function') {
        allProgress = await this.#mediaProgressMemory.listSourceProgress(source || 'plex');
      }
    }

    const progressMap = new Map(allProgress.map(p => [p.contentId, p]));

    // Enrich items from the map (no additional API/file calls)
    return items.map(item => {
      const progress = progressMap.get(item.id);
      if (!progress) return item;

      const playhead = progress.playhead ?? 0;
      const duration = progress.duration || item.duration || 0;

      // After P0 migration, progress.percent should always be present.
      // Fallback calculation kept for: (1) new entries before duration captured, (2) edge cases
      let percent = progress.percent ?? 0;
      if (percent === 0 && playhead > 0 && duration > 0) {
        percent = Math.round((playhead / duration) * 100);
      }

      const isInProgress = percent > 0 && percent < 90;

      return {
        ...item,
        percent,
        playhead,
        duration,
        // Preserve undefined/null for watchTime so classifier can handle missing data
        watchTime: progress.watchTime > 0 ? progress.watchTime : undefined,
        lastPlayed: progress.lastPlayed ?? null,
        completedAt: progress.completedAt ?? null,
        watched: percent >= 90,
        // Set priority to in_progress if partially watched (unless already set)
        priority: isInProgress && !item.priority ? 'in_progress' : item.priority
      };
    });
  }

  /**
   * Public method to enrich items with watch state.
   * Used by API routers to add watch progress to items from any source.
   * @param {Array} items - Items to enrich
   * @param {string} source - Source name for adapter lookup
   * @param {string} [containerId] - Container ID for efficient storage path lookup
   * @returns {Promise<Array>} Enriched items with percent, playhead, watched, etc.
   */
  async enrichWithWatchState(items, source, containerId = null) {
    if (!this.#contentCatalog.hasSource(source)) {
      this.#logger.debug?.('content-query.watch-state.no-adapter', { source });
      return items;
    }
    this.#logger.debug?.('content-query.watch-state.enrich', { source, containerId, itemCount: items.length });
    return this.#enrichWithWatchState(items, source, containerId);
  }

  /**
   * Resolve a query to playable items with selection applied.
   * @param {string} source - Source name
   * @param {string} localId - Local ID/path within source
   * @param {Object} [context] - Selection context
   * @param {Date} [context.now] - Current date
   * @param {string} [context.containerType] - Container type hint
   * @param {Object} [overrides] - Selection strategy overrides
   * @returns {Promise<{items: Array, strategy: Object}>}
   */
  async resolve(source, localId, context = {}, overrides = {}) {
    const resolution = this.#contentCatalog.resolveSource(source, localId);
    if (!resolution) {
      throw new Error(`Unknown source: ${source}`);
    }

    const items = await this.#contentCatalog.resolvePlayables(resolution, localId);
    if (items === null) {
      throw new Error(`Adapter ${source} does not support resolvePlayables`);
    }
    // Pass container ID for efficient batch loading of watch state
    const containerId = `${source}:${localId}`;
    const enriched = await this.#enrichWithWatchState(items, source, containerId);

    // Determine container type from adapter if not provided
    const containerType = context.containerType
      || this.#contentCatalog.containerType(resolution, localId);

    const selectionContext = {
      ...context,
      containerType,
      now: context.now || new Date()
    };

    const strategy = ItemSelectionService.resolveStrategy(selectionContext, overrides);
    const selected = ItemSelectionService.select(enriched, selectionContext, { ...overrides, random: Math.random });

    return {
      items: selected,
      strategy: {
        name: strategy.name,
        filter: strategy.filter,
        sort: strategy.sort,
        pick: strategy.pick
      }
    };
  }
}

/**
 * Determine whether an item is acceptable for audio playback.
 *
 * Voice-assistant rule: surface music, audiobooks, podcasts, songs, and any
 * audio container (album, artist, playlist) — never photos or videos. We use
 * a blocklist on visual media types so unknown audio sources keep working.
 *
 * @param {object} item - Search result item with mediaType / metadata.type
 * @returns {boolean}
 */
/**
 * Apply caller-declared media-type filters.
 *   query.excludeMediaTypes: string[] — drop items whose mediaType / metadata.type / type matches
 *   query.includeMediaTypes: string[] — keep ONLY items whose type matches (allowlist)
 * Both are case-insensitive. Items without a typed field fall through unchanged
 * for the exclude filter, but are dropped by the include filter.
 */
function applyMediaTypeFilters(items, query) {
  let out = items;
  if (Array.isArray(query?.excludeMediaTypes) && query.excludeMediaTypes.length > 0) {
    const blocked = new Set(query.excludeMediaTypes.map(t => String(t).toLowerCase()));
    out = out.filter(item => {
      const types = itemTypes(item);
      return !types.some(t => blocked.has(t));
    });
  }
  if (Array.isArray(query?.includeMediaTypes) && query.includeMediaTypes.length > 0) {
    const allowed = new Set(query.includeMediaTypes.map(t => String(t).toLowerCase()));
    out = out.filter(item => {
      const types = itemTypes(item);
      // Item is kept if ANY of its typed fields matches the allowlist —
      // items typically expose both mediaType ('track') and metadata.type
      // ('audio') and we don't want to require both.
      return types.some(t => allowed.has(t));
    });
  }
  return out;
}

function itemTypes(item) {
  return [item?.mediaType, item?.metadata?.type, item?.type]
    .filter(v => typeof v === 'string')
    .map(v => v.toLowerCase());
}

/**
 * Apply caller-declared weighted secondary ranking. Stable: items with equal
 * scores keep their original (relevance-sorted) order. Items without a value
 * for a factor's field contribute 0 to that factor (don't fail the sort).
 *
 * Each factor: { field: 'a.b.c', weight: 0..1, normalize: 'div:N' | 'log10:N' }
 *   div:N    → min(value / N, 1)
 *   log10:N  → min(log10(value + 1) / log10(N + 1), 1)
 *   none     → raw value clamped to 0..1
 */
function applyWeightedRank(items, factors) {
  if (!Array.isArray(items) || items.length < 2) return items;
  if (!Array.isArray(factors) || factors.length === 0) return items;
  const scored = items.map((item, originalIndex) => ({
    item,
    originalIndex,
    score: factors.reduce((sum, f) => {
      const raw = readPath(item, f.field);
      const n = numberOf(raw);
      const normalized = normalizeValue(n, f.normalize);
      const weight = numberOf(f.weight);
      return sum + (normalized * weight);
    }, 0),
  }));
  scored.sort((a, b) => (b.score - a.score) || (a.originalIndex - b.originalIndex));
  return scored.map(s => s.item);
}

function readPath(obj, path) {
  if (!obj || typeof path !== 'string') return undefined;
  return path.split('.').reduce((cur, key) => (cur == null ? cur : cur[key]), obj);
}

function normalizeValue(n, spec) {
  if (n <= 0) return 0;
  if (typeof spec !== 'string') return Math.min(Math.max(n, 0), 1);
  const [op, capStr] = spec.split(':');
  const cap = numberOf(capStr);
  if (cap <= 0) return Math.min(Math.max(n, 0), 1);
  if (op === 'div') return Math.min(n / cap, 1);
  if (op === 'log10') return Math.min(Math.log10(n + 1) / Math.log10(cap + 1), 1);
  return Math.min(Math.max(n, 0), 1);
}

function numberOf(v) {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default ContentQueryService;
