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

function shuffleArray(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function toQueueItem(item) {
  return {
    id: item.id,
    title: item.title,
    source: item.source,
    mediaUrl: item.mediaUrl,
    mediaType: item.mediaType,
    thumbnail: item.thumbnail,
    duration: item.duration,
    resumable: item.resumable,
    resumePosition: item.resumePosition,
    watchProgress: item.watchProgress,
    shuffle: item.shuffle || false,
    continuous: item.continuous || false,
    resume: item.resume || false,
    parentTitle: item.metadata?.parentTitle,
    grandparentTitle: item.metadata?.grandparentTitle,
    parentId: item.metadata?.parentId,
    parentIndex: item.metadata?.parentIndex,
    itemIndex: item.metadata?.itemIndex
  };
}

export function createQueueRouter(config) {
  const { registry, contentIdResolver, logger = console } = config;
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
    const resolved = contentIdResolver.resolve(compoundId);

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
    let items = playables;

    if (shuffle) {
      items = shuffleArray([...items]);
    }

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
