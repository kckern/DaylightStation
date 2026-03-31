// backend/src/4_api/v1/routers/queue.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';
import { ContentExpression } from '#domains/content/ContentExpression.mjs';

export function toQueueItem(item) {
  const qi = {
    // Identity
    id: item.id,           // React key + backwards compat
    contentId: item.id,    // Canonical content identifier (source:localId)
    title: item.title,
    source: item.source,

    // Playback
    mediaUrl: item.mediaUrl,
    mediaType: item.mediaType,
    format: item.metadata?.contentFormat || item.metadata?.format || item.mediaType,
    duration: item.duration,

    // Display
    thumbnail: item.thumbnail,
    image: item.thumbnail,

    // Resume state
    resumable: item.resumable,
    resumePosition: item.resumePosition,
    watchProgress: item.watchProgress,

    // Behavior flags
    shuffle: item.shuffle || false,
    continuous: item.continuous || false,
    resume: item.resume || false,
    active: item.active !== false,

    // Hierarchy context
    parentTitle: item.metadata?.parentTitle,
    grandparentTitle: item.metadata?.grandparentTitle,
    parentId: item.metadata?.parentId,
    parentIndex: item.metadata?.parentIndex,
    itemIndex: item.metadata?.itemIndex,

    // Audio metadata
    artist: item.metadata?.artist || item.metadata?.grandparentTitle,
    albumArtist: item.metadata?.albumArtist,
    album: item.metadata?.album || item.metadata?.parentTitle,

    // List identity for server-side progress namespace resolution
    listId: item.metadata?.listId || null,
  };

  // Readalong content (scripture, poetry, talks) — text body + style for ContentScroller
  if (item.content) qi.content = item.content;
  if (item.style) qi.style = item.style;
  if (item.subtitle) qi.subtitle = item.subtitle;

  // Slideshow config (stamped by QueryAdapter on image items)
  if (item.slideshow) qi.slideshow = item.slideshow;
  if (item.titlecard) qi.titlecard = item.titlecard;
  if (item.segment) qi.segment = item.segment;

  // Rich metadata for image rendering (people/faces, dimensions)
  if (item.metadata) {
    qi.metadata = {
      width: item.metadata.width,
      height: item.metadata.height,
      ...(item.metadata.people?.length > 0 && { people: item.metadata.people }),
      ...(item.metadata.capturedAt && { capturedAt: item.metadata.capturedAt }),
      ...(item.metadata.location && { location: item.metadata.location }),
    };
  }

  return qi;
}

export function createQueueRouter(config) {
  const { contentIdResolver, queueService, logger = console } = config;
  const router = express.Router();

  const handleQueueRequest = asyncHandler(async (req, res) => {
    const { source } = req.params;
    const rawPath = req.params[0] || '';

    const { source: parsedSource, localId, compoundId } = parseActionRouteId({
      source,
      path: rawPath
    });

    const expr = ContentExpression.fromQuery(req.query);
    const shuffle = expr.options.shuffle === true || expr.options.shuffle === 'true' || expr.options.shuffle === '1';
    const limitRaw = expr.options.limit;
    const limitParsed = Number.parseInt(limitRaw, 10);
    const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : null;

    // Resolve through ContentIdResolver (handles aliases, prefixes, exact matches)
    let resolved = contentIdResolver.resolve(compoundId);

    // Fallback: if resolution failed and there's no localId, the source segment
    // might be a bare content reference (e.g., "music-queue", "fhe").
    // Try resolving the raw source name directly through ContentIdResolver.
    if (!resolved?.adapter && !localId && parsedSource) {
      resolved = contentIdResolver.resolve(parsedSource);
    }

    // Fallback: try as a saved query name (query:name) for bare names
    if (!resolved?.adapter && !localId && parsedSource) {
      resolved = contentIdResolver.resolve(`query:${parsedSource}`);
    }

    let adapter = resolved?.adapter;
    let finalId = resolved ? `${resolved.source}:${resolved.localId}` : compoundId;
    const resolvedSource = resolved?.source ?? parsedSource;

    if (!adapter) {
      return res.status(404).json({ error: `Unknown source: ${resolvedSource}` });
    }

    if (!adapter.resolvePlayables) {
      return res.status(400).json({
        error: 'Source does not support queue resolution',
        source: resolvedSource
      });
    }

    const playables = await adapter.resolvePlayables(finalId);
    const audioConfig = playables.audio || null;

    let items = await queueService.resolveQueue(playables, resolvedSource, { shuffle });

    if (limit) {
      items = items.slice(0, limit);
    }

    const totalDuration = items.reduce((sum, item) => sum + (item.duration || 0), 0);

    logger.info?.('queue.resolve', {
      source: resolvedSource,
      localId,
      count: items.length,
      totalDuration
    });

    const queueItems = items.map(toQueueItem);

    res.json({
      source: resolvedSource,
      id: compoundId,
      count: queueItems.length,
      totalDuration,
      thumbnail: queueItems[0]?.thumbnail || null,
      ...(audioConfig && { audio: audioConfig }),
      items: queueItems
    });
  });

  router.get('/:source/*', handleQueueRequest);
  router.get('/:source', handleQueueRequest);

  return router;
}

export default createQueueRouter;
