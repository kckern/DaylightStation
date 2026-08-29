// backend/src/4_api/v1/routers/queue.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';
import { presentPublicResources } from '../presenters/publicResourceRefs.mjs';

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
  if (item.surround) qi.surround = item.surround;
  if (item.surroundPart !== undefined) qi.surroundPart = item.surroundPart;

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
  // `contentExpression` is INJECTED. A router may not import 2_domains
  // (api-layer-guidelines.md: "API has no domain knowledge"); it receives the
  // parser and calls fromQuery on it.
  const { contentExpression } = config;
  const { contentAccessService, logger = console } = config;
  const { queuePresentationService } = config;
  const router = express.Router();

  const handleQueueRequest = asyncHandler(async (req, res) => {
    const { source } = req.params;
    const rawPath = splatPath(req);

    const { source: parsedSource, localId, compoundId } = parseActionRouteId({
      source,
      path: rawPath
    });

    const expr = contentExpression.fromQuery(req.query);
    const shuffle = expr.options.shuffle === true || expr.options.shuffle === 'true' || expr.options.shuffle === '1';
    const limitRaw = expr.options.limit;
    const limitParsed = Number.parseInt(limitRaw, 10);
    const limit = Number.isFinite(limitParsed) && limitParsed > 0 ? limitParsed : null;

    const outcome = await contentAccessService.queue({ compoundId, parsedSource, localId, shuffle });
    const resolvedSource = outcome.source;

    if (outcome.kind === 'unknown_source') {
      logger.warn?.('queue.source.unknown', { compoundId, source: resolvedSource, ip: req.ip });
      return res.status(404).json({ error: `Unknown source: ${resolvedSource}` });
    }

    if (outcome.kind === 'unsupported') {
      logger.warn?.('queue.source.no_playables', { compoundId, source: resolvedSource, ip: req.ip });
      return res.status(400).json({
        error: 'Source does not support queue resolution',
        source: resolvedSource
      });
    }

    const finalId = outcome.finalId;
    const audioConfig = outcome.audio;
    const { items, totalDuration } = queuePresentationService.prepare({
      containerId: finalId,
      items: outcome.items,
      limit,
    });

    logger.info?.('queue.resolve', {
      source: resolvedSource,
      localId,
      count: items.length,
      totalDuration
    });

    const queueItems = presentPublicResources(items.map(toQueueItem));

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

  router.get('/:source/*splat', handleQueueRequest);
  router.get('/:source', handleQueueRequest);

  return router;
}

export default createQueueRouter;
