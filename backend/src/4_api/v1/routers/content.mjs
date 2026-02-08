// backend/src/4_api/routers/content.mjs
import express from 'express';
import { nowTs24 } from '#system/utils/index.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { isMediaSearchable, validateSearchQuery } from '#domains/media/IMediaSearchable.mjs';
import { parseContentQuery, validateContentQuery } from '../parsers/contentQueryParser.mjs';

/**
 * Create content API router
 *
 * Endpoints:
 * - GET /api/content/item/:source/* - Get single item info
 * - GET /api/content/playables/:source/* - Resolve to playable items (DEPRECATED: use /api/v1/queue)
 * - POST /api/content/progress/:source/* - Update watch progress
 * - GET /api/content/search - Search across content sources (IMediaSearchable)
 * - POST /api/content/compose - Compose multi-track presentation from sources
 * - GET /api/content/:source/image/:id - DEPRECATED: Redirects to /api/v1/display/:source/:id
 * - GET /api/content/:source/info/:id - DEPRECATED: Redirects to /api/v1/info/:source/:id
 *
 * Note: List endpoint moved to /api/v1/list/:source/* (list.mjs)
 * Note: Menu logging moved to /api/v1/item/menu-log (item.mjs)
 *
 * @param {import('#domains/content/services/ContentSourceRegistry.mjs').ContentSourceRegistry} registry
 * @param {import('#adapters/persistence/yaml/YamlMediaProgressMemory.mjs').YamlMediaProgressMemory} [mediaProgressMemory=null] - Optional media progress memory store
 * @param {Object} [options] - Additional options
 * @param {import('#apps/content/usecases/ComposePresentationUseCase.mjs').ComposePresentationUseCase} [options.composePresentationUseCase] - Use case for composing presentations
 * @param {import('#apps/content/ContentQueryService.mjs').ContentQueryService} [options.contentQueryService] - Content query service for unified search/list
 * @param {import('#apps/content/services/ContentQueryAliasResolver.mjs').ContentQueryAliasResolver} [options.aliasResolver] - Alias resolver for content queries
 * @param {Object} [options.logger] - Logger instance
 * @returns {express.Router}
 */
export function createContentRouter(registry, mediaProgressMemory = null, options = {}) {
  const { composePresentationUseCase, contentQueryService, aliasResolver, logger = console } = options;
  const router = express.Router();

  /**
   * Create media progress object with toJSON method for datastore compatibility
   * @param {Object} props - Media progress properties
   * @returns {Object}
   */
  function createMediaProgressDTO(props) {
    const { itemId, playhead = 0, duration = 0, playCount = 0, lastPlayed = null, watchTime = 0 } = props;
    const percent = duration > 0 ? Math.round((playhead / duration) * 100) : 0;
    return {
      itemId,
      playhead,
      duration,
      percent,
      playCount,
      lastPlayed,
      watchTime,
      toJSON() {
        return {
          itemId: this.itemId,
          playhead: this.playhead,
          duration: this.duration,
          percent: this.percent,
          playCount: this.playCount,
          lastPlayed: this.lastPlayed,
          watchTime: this.watchTime
        };
      }
    };
  }

  /**
   * Check if media progress indicates the item is fully watched
   * @param {Object} state - Plain media progress object
   * @returns {boolean}
   */
  function isWatched(state) {
    if (!state || !state.duration) return false;
    const percent = state.percent ?? (state.playhead && state.duration > 0
      ? Math.round((state.playhead / state.duration) * 100)
      : 0);
    return percent >= 90;
  }

  /**
   * GET /api/content/item/:source/*
   * Get single item info
   */
  router.get('/item/:source/*', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const localId = req.params[0] || '';

    // Try exact source match first, then prefix resolution
    let adapter = registry.get(source);
    let resolvedLocalId = localId;

    if (!adapter) {
      // Try prefix-based resolution (e.g., canvas:religious/nativity.jpg)
      const resolved = registry.resolveFromPrefix(source, localId);
      if (resolved) {
        adapter = resolved.adapter;
        resolvedLocalId = resolved.localId;
      }
    }

    if (!adapter) {
      return res.status(404).json({ error: `Unknown source: ${source}` });
    }

    const item = await adapter.getItem(resolvedLocalId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found', source, localId: resolvedLocalId });
    }

    res.json(item);
  }));

  /**
   * GET /api/content/playables/:source/*
     * Resolve to playable items (deprecated: use /api/v1/queue)
   */
    router.get('/playables/:source/*', asyncHandler(async (req, res) => {
      const { source } = req.params;
      const localId = req.params[0] || '';
      const queryIndex = req.url.indexOf('?');
      const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
      const newUrl = `/api/v1/queue/${source}/${localId}${query}`;

      res.set('Deprecation', 'true');
      res.set('Sunset', 'Fri, 21 Feb 2026 00:00:00 GMT');
      res.set('Link', `<${newUrl}>; rel="successor-version"`);
      res.redirect(307, newUrl);
    }));

  /**
   * POST /api/content/progress/:source/*
   * Update watch progress for an item
   */
  router.post('/progress/:source/*', asyncHandler(async (req, res) => {
    if (!mediaProgressMemory) {
      return res.status(501).json({ error: 'Media progress storage not configured' });
    }

    const { source } = req.params;
    const localId = req.params[0] || '';
    const { seconds, duration } = req.body;

    if (typeof seconds !== 'number' || typeof duration !== 'number') {
      return res.status(400).json({ error: 'seconds and duration are required numbers' });
    }

    // Try exact source match first, then prefix resolution
    let adapter = registry.get(source);
    let resolvedLocalId = localId;

    if (!adapter) {
      const resolved = registry.resolveFromPrefix(source, localId);
      if (resolved) {
        adapter = resolved.adapter;
        resolvedLocalId = resolved.localId;
      }
    }

    if (!adapter) {
      return res.status(404).json({ error: `Unknown source: ${source}` });
    }

    const itemId = `${source}:${resolvedLocalId}`;
    const storagePath = typeof adapter.getStoragePath === 'function'
      ? await adapter.getStoragePath(resolvedLocalId)
      : source;

    // Get existing state or create new one
    const existing = await mediaProgressMemory.get(itemId, storagePath);
    const state = createMediaProgressDTO({
      itemId,
      playhead: seconds,
      duration,
      playCount: (existing?.playCount || 0) + (seconds === 0 ? 1 : 0),
      lastPlayed: nowTs24(),
      watchTime: (existing?.watchTime || 0) + Math.max(0, seconds - (existing?.playhead || 0))
    });

    await mediaProgressMemory.set(state, storagePath);

    res.json({
      itemId,
      playhead: state.playhead,
      duration: state.duration,
      percent: state.percent,
      watched: isWatched(state)
    });
  }));

  // ==========================================================================
  // Discovery Endpoints (Sources and Aliases)
  // ==========================================================================

  /**
   * GET /api/content/sources
   * Returns available sources, categories, and providers from the registry.
   * Used by slot machine and test fixtures to discover what content is available.
   */
  router.get('/sources', (req, res) => {
    const sources = registry.list();
    const categories = registry.getCategories();
    const providers = registry.getProviders();
    res.json({ sources, categories, providers });
  });

  /**
   * GET /api/content/aliases
   * Returns built-in and user-defined query aliases.
   * Used by slot machine to generate valid test queries.
   */
  router.get('/aliases', (req, res) => {
    if (!aliasResolver) {
      return res.status(501).json({
        error: 'Alias resolver not configured',
        code: 'ALIAS_RESOLVER_NOT_CONFIGURED'
      });
    }

    const builtInAliases = aliasResolver.getBuiltInAliases();
    const allAliases = aliasResolver.getAvailableAliases();
    const userDefined = allAliases.filter(a => !Object.keys(builtInAliases).includes(a));
    const categories = registry.getCategories();

    res.json({
      builtIn: Object.keys(builtInAliases),
      userDefined,
      categories,
    });
  });

  // ==========================================================================
  // Unified Query Interface (ContentQueryService)
  // ==========================================================================

  /**
   * GET /api/content/query/search
   * Search across content sources using unified query interface.
   *
   * Query params:
   * - source: Source filter (source name, provider like "immich", or category like "gallery")
   * - text: Free text search
   * - person: Person filter (canonical, translated per-adapter)
   * - creator: Creator/author filter
   * - time: Time filter (2025, 2025-06, 2024..2025, summer)
   * - duration: Duration filter (30, 3m, 1h, 3m..10m)
   * - mediaType: image, video, audio
   * - capability: playable, displayable, readable, listable
   * - favorites: Boolean
   * - sort: date, title, random (aliases: shuffle, rand)
   * - take, skip: Pagination
   * - {adapter}.{key}: Adapter-specific keys (e.g., immich.location)
   */
  router.get('/query/search', asyncHandler(async (req, res) => {
    const requestStart = performance.now();

    if (!contentQueryService) {
      return res.status(501).json({
        error: 'Content query service not configured',
        code: 'QUERY_SERVICE_NOT_CONFIGURED'
      });
    }

    const query = parseContentQuery(req.query);
    const validation = validateContentQuery(query);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors
      });
    }

    try {
      const result = await contentQueryService.search(query);
      const totalMs = Math.round(performance.now() - requestStart);

      // Log request performance (service-level perf already logged internally)
      if (totalMs > 5000) {
        logger.warn?.('content.query.search.slow', {
          query: { text: query.text, source: query.source },
          totalMs,
          resultCount: result.items?.length ?? 0,
        });
      }

      // Include perf in response for debugging (can be stripped in production)
      const { _perf, ...cleanResult } = result;
      res.json({
        query,
        ...cleanResult,
        _perf: { ...(_perf || {}), requestMs: totalMs },
      });
    } catch (error) {
      logger.error?.('content.query.search.error', { query, error: error.message });
      res.status(500).json({ error: 'Search failed', message: error.message });
    }
  }));

  /**
   * GET /api/content/query/search/stream
   * Stream search results via SSE as each adapter completes.
   *
   * Same query params as /query/search, but returns Server-Sent Events:
   * - event: pending (initial, lists all sources)
   * - event: results (per adapter, includes items and remaining pending)
   * - event: complete (final, includes totalMs)
   */
  router.get('/query/search/stream', asyncHandler(async (req, res) => {
    if (!contentQueryService) {
      return res.status(501).json({
        error: 'Content query service not configured',
        code: 'QUERY_SERVICE_NOT_CONFIGURED'
      });
    }

    const query = parseContentQuery(req.query);
    const validation = validateContentQuery(query);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors
      });
    }

    // Validate minimum search length
    if (!query.text || query.text.length < 2) {
      return res.status(400).json({
        error: 'Search text must be at least 2 characters',
        code: 'SEARCH_TEXT_TOO_SHORT'
      });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Handle client disconnect
    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    try {
      for await (const event of contentQueryService.searchStream(query)) {
        if (closed) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      if (!closed) {
        res.write(`data: ${JSON.stringify({ event: 'error', message: error.message })}\n\n`);
      }
      logger.error?.('content.query.search.stream.error', { query, error: error.message });
    }

    res.end();
  }));

  /**
   * GET /api/content/query/list
   * List containers (playlists, albums, people, etc.) using unified query interface.
   *
   * Query params:
   * - from: Required. Container alias (playlists, albums, people, cameras, etc.)
   * - source: Source filter (optional)
   * - pick: "random" to return contents of a randomly selected container
   * - sort: Sorting for results
   * - take, skip: Pagination
   */
  router.get('/query/list', asyncHandler(async (req, res) => {
    if (!contentQueryService) {
      return res.status(501).json({
        error: 'Content query service not configured',
        code: 'QUERY_SERVICE_NOT_CONFIGURED'
      });
    }

    const query = parseContentQuery(req.query);
    const validation = validateContentQuery(query);

    if (!validation.valid) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors
      });
    }

    if (!query.from) {
      return res.status(400).json({
        error: 'Missing required parameter: from',
        code: 'MISSING_FROM_PARAM'
      });
    }

    try {
      const result = await contentQueryService.list(query);
      res.json({
        from: query.from,
        ...result
      });
    } catch (error) {
      logger.error?.('content.query.list.error', { query, error: error.message });
      res.status(500).json({ error: 'List failed', message: error.message });
    }
  }));

  // ==========================================================================
  // Legacy Search Routes (IMediaSearchable)
  // ==========================================================================

  /**
   * GET /api/content/search
   * Search across content sources that implement IMediaSearchable
   * @deprecated Use /api/content/query/search instead
   *
   * Query params:
   * - sources: Comma-separated source filter (optional, defaults to all searchable)
   * - text: Free text search
   * - people: Comma-separated person names
   * - dateFrom, dateTo: ISO date range
   * - location: City/state/country
   * - mediaType: image, video, or audio
   * - favorites: Boolean (true/1)
   * - take, skip: Pagination
   * - sort: date, title, or random
   */
  router.get('/search', asyncHandler(async (req, res) => {
    // Parse sources filter
    const sourcesParam = req.query.sources;
    const requestedSources = sourcesParam ? sourcesParam.split(',').map(s => s.trim()) : null;

    // Build search query from query params
    const query = {};
    if (req.query.text) query.text = req.query.text;
    if (req.query.people) query.people = req.query.people.split(',').map(p => p.trim());
    if (req.query.dateFrom) query.dateFrom = req.query.dateFrom;
    if (req.query.dateTo) query.dateTo = req.query.dateTo;
    if (req.query.location) query.location = req.query.location;
    if (req.query.mediaType) query.mediaType = req.query.mediaType;
    if (req.query.favorites === 'true' || req.query.favorites === '1') query.favorites = true;
    if (req.query.take) query.take = parseInt(req.query.take, 10);
    if (req.query.skip) query.skip = parseInt(req.query.skip, 10);
    if (req.query.sort) query.sort = req.query.sort;
    if (req.query.tags) query.tags = req.query.tags.split(',').map(t => t.trim());

    // Validate query
    try {
      validateSearchQuery(query);
    } catch (err) {
      return res.status(400).json({ error: err.message, code: err.code });
    }

    // Find all searchable adapters
    const allSources = registry.list();
    const searchableAdapters = [];

    for (const sourceName of allSources) {
      // If sources filter provided, skip non-matching
      if (requestedSources && !requestedSources.includes(sourceName)) continue;

      const adapter = registry.get(sourceName);
      if (isMediaSearchable(adapter)) {
        searchableAdapters.push({ name: sourceName, adapter });
      }
    }

    if (searchableAdapters.length === 0) {
      const msg = requestedSources
        ? `No searchable adapters found for sources: ${requestedSources.join(', ')}`
        : 'No searchable adapters configured';
      return res.status(404).json({ error: msg });
    }

    // Execute search on all adapters
    const allItems = [];
    let totalCount = 0;
    const searchedSources = [];

    for (const { name, adapter } of searchableAdapters) {
      try {
        const result = await adapter.search(query);
        searchedSources.push(name);
        totalCount += result.total || result.items?.length || 0;

        // Add source attribution to items if not present
        const items = (result.items || []).map(item => ({
          ...item,
          source: item.source || name
        }));
        allItems.push(...items);
      } catch (err) {
        logger.warn?.('content.search.adapter.error', { source: name, error: err.message });
        // Continue with other adapters
      }
    }

    res.json({
      query,
      sources: searchedSources,
      total: totalCount,
      items: allItems
    });
  }));

  // ==========================================================================
  // Compose Route (Multi-track Presentations)
  // ==========================================================================

  /**
   * POST /api/content/compose
   * Compose a multi-track presentation from heterogeneous sources.
   *
   * Request body:
   * {
   *   "sources": ["plex:12345", "plex:67890"],  // Required: array of source identifiers
   *   "config": {
   *     "advance": { "mode": "timed", "interval": 5000 },
   *     "loop": true,
   *     "shuffle": true,
   *     "layout": "fullscreen"
   *   }
   * }
   *
   * Source format:
   * - [track:]provider:id - e.g., "visual:plex:12345" or "audio:plex:67890"
   * - Numeric-only assumes Plex: "12345" -> "plex:12345"
   * - Track prefix is optional; inferred from mediaType if omitted
   *
   * Response: IComposedPresentation object
   */
  router.post('/compose', asyncHandler(async (req, res) => {
    if (!composePresentationUseCase) {
      return res.status(501).json({
        error: 'Compose endpoint not configured',
        code: 'COMPOSE_NOT_CONFIGURED'
      });
    }

    const { sources, config = {} } = req.body;

    // Validate sources is non-empty array
    if (!sources || !Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({
        error: 'sources must be a non-empty array of source identifiers',
        code: 'INVALID_SOURCES'
      });
    }

    try {
      const presentation = await composePresentationUseCase.compose(sources, config);
      res.json(presentation);
    } catch (err) {
      // Handle application errors with appropriate status codes
      if (err.code === 'INVALID_INPUT' || err.code === 'NO_VISUAL_TRACK') {
        return res.status(400).json({
          error: err.message,
          code: err.code,
          details: err.details
        });
      }
      if (err.code === 'ITEM_NOT_FOUND' || err.name === 'ServiceNotFoundError') {
        return res.status(404).json({
          error: err.message,
          code: err.code || 'NOT_FOUND',
          details: err.details
        });
      }
      // Re-throw unexpected errors for the error handler middleware
      throw err;
    }
  }));

  // ==========================================================================
  // Deprecation Redirects (301 to new action-based routes)
  // ==========================================================================

  /**
   * DEPRECATED: Redirect to /api/v1/display/:source/:id
   * @deprecated Use /api/v1/display/:source/:id instead
   */
  router.get('/:source/image/:id', (req, res) => {
    const { source, id } = req.params;
    const newUrl = `/api/v1/display/${source}/${id}`;
    logger.info?.('content.image.deprecated_redirect', { from: req.originalUrl, to: newUrl });
    res.redirect(301, newUrl);
  });

  /**
   * DEPRECATED: Redirect to /api/v1/info/:source/:id
   * @deprecated Use /api/v1/info/:source/:id instead
   */
  router.get('/:source/info/:id/:modifiers?', (req, res) => {
    const { source, id, modifiers } = req.params;
    const newUrl = modifiers
      ? `/api/v1/info/${source}/${id}/${modifiers}`
      : `/api/v1/info/${source}/${id}`;
    logger.info?.('content.info.deprecated_redirect', { from: req.originalUrl, to: newUrl });
    res.redirect(301, newUrl);
  });

  return router;
}

export default createContentRouter;
