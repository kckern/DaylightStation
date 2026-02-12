// backend/src/4_api/v1/routers/queue.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';

function parseQueueQuery(query = {}) {
  const shuffleRaw = query.shuffle;
  const limitRaw = query.limit;

  const shuffle = shuffleRaw === true || shuffleRaw === 'true' || shuffleRaw === '1';
  const limit = Number.parseInt(limitRaw, 10);

  return {
    shuffle,
    limit: Number.isFinite(limit) && limit > 0 ? limit : null
  };
}

export function toQueueItem(item) {
  return {
    // Identity
    id: item.id,
    contentId: item.id,
    title: item.title,
    source: item.source,

    // Playback
    mediaUrl: item.mediaUrl,
    mediaType: item.mediaType,
    format: item.metadata?.format || item.mediaType,
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
  };
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

    const { shuffle, limit } = parseQueueQuery(req.query);

    // Resolve through ContentIdResolver (handles aliases, prefixes, exact matches)
    let resolved = contentIdResolver.resolve(compoundId);

    // Fallback: if resolution failed and there's no localId, the source segment
    // might be a bare content reference (e.g., "music-queue", "fhe").
    // Try resolving the raw source name directly through ContentIdResolver.
    if (!resolved?.adapter && !localId && parsedSource) {
      resolved = contentIdResolver.resolve(parsedSource);
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

    res.json({
      source: resolvedSource,
      id: compoundId,
      count: items.length,
      totalDuration,
      items: items.map(toQueueItem)
    });
  });

  router.get('/:source/*', handleQueueRequest);
  router.get('/:source', handleQueueRequest);

  return router;
}

export default createQueueRouter;
