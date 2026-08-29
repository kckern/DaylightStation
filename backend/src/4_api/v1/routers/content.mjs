import { sendInternalError } from '#api/utils/internalError.mjs';
// backend/src/4_api/routers/content.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseContentQuery, validateContentQuery } from '../parsers/contentQueryParser.mjs';
import { stripEmpty } from '#api/v1/utils/stripEmpty.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';
import { presentPublicResources } from '../presenters/publicResourceRefs.mjs';

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
 * @param {Object} [options] - Additional options
 * @param {Object} options.contentDiscovery - Semantic content discovery facade
 * @param {import('#apps/content/usecases/UpdateContentProgress.mjs').UpdateContentProgress} [options.updateContentProgress]
 * @param {import('#apps/content/usecases/ComposePresentationUseCase.mjs').ComposePresentationUseCase} [options.composePresentationUseCase] - Use case for composing presentations
 * @param {import('#apps/content/ContentQueryService.mjs').ContentQueryService} [options.contentQueryService] - Content query service for unified search/list
 * @param {import('#apps/content/services/ContentQueryAliasResolver.mjs').ContentQueryAliasResolver} [options.aliasResolver] - Alias resolver for content queries
 * @param {Object} [options.logger] - Logger instance
 * @returns {express.Router}
 */
export function createContentRouter(options = {}) {
  const {
    composePresentationUseCase,
    contentQueryService,
    contentAliasCatalog,
    contentAccessPolicy,
    contentDiscovery,
    updateContentProgress = null,
    findContentAlternates = null,
    validateSearchQuery = () => {},
    logger = console,
  } = options;
  const router = express.Router();

  /**
   * GET /api/content/item/:source/*
   * Get single item info
   */
  router.get('/item/:source{/*splat}', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const localId = splatPath(req);

    const result = await contentDiscovery.getItem(source, localId);
    if (result.kind === 'unknown_source') {
      return res.status(404).json({ error: `Unknown source: ${source}` });
    }
    if (result.kind === 'not_found') {
      return res.status(404).json({ error: 'Item not found', source, localId: result.localId });
    }
    res.json(presentPublicResources(result.item));
  }));

  /**
   * GET /api/content/playables/:source/*
     * Resolve to playable items (deprecated: use /api/v1/queue)
   */
    router.get('/playables/:source{/*splat}', asyncHandler(async (req, res) => {
      const { source } = req.params;
      const localId = splatPath(req);
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
  router.post('/progress/:source{/*splat}', asyncHandler(async (req, res) => {
    if (!updateContentProgress?.isConfigured?.()) {
      return res.status(501).json({ error: 'Media progress storage not configured' });
    }

    const { source } = req.params;
    const localId = splatPath(req);
    const { seconds, duration } = req.body;

    if (typeof seconds !== 'number' || typeof duration !== 'number') {
      return res.status(400).json({ error: 'seconds and duration are required numbers' });
    }

    const result = await updateContentProgress.execute({ source, localId, seconds, duration });
    if (!result) {
      return res.status(404).json({ error: `Unknown source: ${source}` });
    }
    res.json(result);
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
    res.json(contentDiscovery.getSources());
  });

  /**
   * GET /api/content/alternates/:source/*
   *
   * Other content ids addressing the SAME file as this one, with what each can
   * do. The admin uses it to offer a working id when a row's action and its
   * source's capabilities disagree — `action: Display` on a `files:` image,
   * which is playable-only, while the identical bytes under `canvas:` are
   * displayable.
   *
   * Always 200. An id with no filesystem identity, or one nothing else reaches,
   * yields an empty list — this is advisory, and a 4xx would make the admin
   * paint an alarming state on a perfectly healthy row.
   */
  router.get('/alternates/:source{/*splat}', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const rawPath = splatPath(req);
    const { compoundId } = parseActionRouteId({ source, path: rawPath });

    if (typeof findContentAlternates !== 'function') {
      return res.status(501).json({ error: 'Content alternates not configured' });
    }
    const alternates = await findContentAlternates(compoundId);

    logger.info?.('content.alternates', {
      contentId: compoundId,
      found: alternates.map(a => a.contentId),
    });
    res.json({ contentId: compoundId, alternates });
  }));

  /**
   * GET /api/content/aliases
   * Returns built-in and user-defined query aliases.
   * Used by slot machine to generate valid test queries.
   */
  router.get('/aliases', (req, res) => {
    if (!contentAliasCatalog?.available) {
      return res.status(501).json({
        error: 'Alias resolver not configured',
        code: 'ALIAS_RESOLVER_NOT_CONFIGURED'
      });
    }

    res.json(contentAliasCatalog.catalog());
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

    logger.info?.('content.query.search.request', {
      text: query.text,
      source: query.source,
      take: query.take,
      skip: query.skip,
      sort: query.sort,
      mediaType: query.mediaType,
      ip: req.ip
    });

    if (!validation.valid) {
      logger.warn?.('content.query.search.validation_failed', { query, errors: validation.errors });
      return res.status(400).json({
        error: 'Validation failed',
        details: validation.errors
      });
    }

    try {
      const result = await contentQueryService.search(query);
      const totalMs = Math.round(performance.now() - requestStart);

      const resultCount = result.items?.length ?? 0;
      logger.info?.('content.query.search.response', {
        text: query.text,
        source: query.source,
        resultCount,
        totalMs,
        items: (result.items || []).slice(0, 10).map(i => ({ id: i.id, title: i.title, source: i.source, type: i.metadata?.type || i.type }))
      });

      // Log request performance (service-level perf already logged internally)
      if (totalMs > 5000) {
        logger.warn?.('content.query.search.slow', {
          query: { text: query.text, source: query.source },
          totalMs,
          resultCount,
        });
      }

      // Include perf in response for debugging (can be stripped in production)
      const { _perf, ...cleanResult } = result;
      res.json({
        query,
        ...cleanResult,
        items: (cleanResult.items || []).map(stripEmpty),
        _perf: { ...(_perf || {}), requestMs: totalMs },
      });
    } catch (error) {
      logger.error?.('content.query.search.error', { query, error: error.message });
      sendInternalError(res, { error: 'Search failed', message: error.message });
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

    // Handle client disconnect. Setting a flag alone is NOT enough: the
    // for-await below can be parked on a hung adapter promise, in which case
    // the loop never resumes to observe the flag, res.end() is never reached,
    // and the socket sits in CLOSE_WAIT forever while the generator context
    // pins heap. Under EventSource churn (every keystroke opens/closes a
    // stream) this exhausted ephemeral ports and OOM-killed the process.
    // So on close we end the response immediately and ask the iterator to
    // finish; a hard deadline covers generators stuck past the adapter
    // timeouts.
    const STREAM_DEADLINE_MS = 30000;
    let closed = false;
    const iterator = contentQueryService.searchStream(query)[Symbol.asyncIterator]();
    const finish = () => {
      if (closed) return;
      closed = true;
      try { res.end(); } catch { /* socket already gone */ }
      iterator.return?.().catch(() => {});
    };
    req.on('close', finish);
    const deadline = setTimeout(() => {
      logger.warn?.('content.query.search.stream.deadline', { query, deadlineMs: STREAM_DEADLINE_MS });
      finish();
    }, STREAM_DEADLINE_MS);

    try {
      while (true) {
        const { value: event, done } = await iterator.next();
        if (closed || done) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      if (!closed) {
        res.write(`data: ${JSON.stringify({ event: 'error', message: error.message })}\n\n`);
      }
      logger.error?.('content.query.search.stream.error', { query, error: error.message });
    } finally {
      clearTimeout(deadline);
      req.off('close', finish);
      if (!closed) {
        closed = true;
        res.end();
      }
    }
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
        ...result,
        items: (result.items || []).map(stripEmpty),
      });
    } catch (error) {
      logger.error?.('content.query.list.error', { query, error: error.message });
      sendInternalError(res, { error: 'List failed', message: error.message });
    }
  }));

  // ==========================================================================
  // Legacy Search Routes (IMediaSearchable)
  // ==========================================================================

  /**
   * GET /api/content/search
   * Search across content sources that implement IMediaSearchable
   * @deprecated Use /api/v1/content/query/search instead. Sunset: 2026-09-01.
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
    // DEPRECATED: superseded by /api/v1/content/query/search (unified query interface).
    res.set('Deprecation', 'true');
    res.set('Sunset', 'Tue, 01 Sep 2026 00:00:00 GMT');
    res.set('Link', '</api/v1/content/query/search>; rel="successor-version"');

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

    const result = await contentDiscovery.searchLegacy({ requestedSources, query });
    if (result.kind === 'none') {
      const msg = requestedSources
        ? `No searchable adapters found for sources: ${requestedSources.join(', ')}`
        : 'No searchable adapters configured';
      return res.status(404).json({ error: msg });
    }
    res.json({
      query,
      sources: result.sources,
      total: result.total,
      items: result.items
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
  // Schedule Endpoint
  // ==========================================================================

  /**
   * GET /api/content/schedule/:source
   * Check if content from a source is currently within its allowed schedule.
   * Returns availability status, next window, and full schedule.
   */
  router.get('/schedule/:source', (req, res) => {
    res.json(contentAccessPolicy?.schedule?.() || { available: true, nextWindow: null, schedule: null });
  });

  /**
   * GET /api/content/launch-targets/:source
   * Which devices a parent may launch this source's content on, and which
   * titles on each.
   *
   * Single source of truth for the allowlist, read by BOTH the admin UI (to
   * decide what to offer) and the kiosk (to re-check on receipt). They must
   * agree: the allowlist exists because a title with a live save on one device
   * must not boot on a second, and there is no save-sync to reconcile two
   * divergent saves afterwards. Splitting it across two config files would let
   * them drift, so it lives in games.yml only and is served from here.
   *
   * Read-only and unauthenticated, matching /schedule/:source above — it
   * exposes content ids the caller can already list, and the kiosk has no admin
   * credentials.
   */
  router.get('/launch-targets/:source', (req, res) => {
    const targets = contentAccessPolicy?.launchTargets?.(req.params.source) || [];
    res.json({ targets });
  });

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
  router.get('/:source/info/:id{/:modifiers}', (req, res) => {
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
