// backend/src/4_api/v1/routers/queue.mjs
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';

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
  // `contentExpression` is INJECTED. A router may not import 2_domains
  // (api-layer-guidelines.md: "API has no domain knowledge"); it receives the
  // parser and calls fromQuery on it.
  const { contentExpression } = config;
  const { contentIdResolver, queueService, logger = console } = config;
  // Optional surround sidecar lookup (ISurroundStore port). Absent → the queue
  // projection is exactly what it always was.
  //
  // `surroundPlanner` is INJECTED for the same reason `contentExpression` is: a
  // router may not import 3_applications (api-layer-guidelines.md, FORBIDDEN
  // imports: "Containers are injected | Receive via factory params"). It decides
  // container expansion and authored order; this router only asks and projects.
  //
  // `surroundEnforceOrder` is config `surround.enforceOrder`, resolved in
  // composition and defaulting to true here as well, so a router built without
  // it still imposes a container's authored order rather than silently opting
  // every programme out.
  const { surroundStore = null, surroundPlanner = null, surroundEnforceOrder = true } = config;
  // Surround keeps its own subsystem identity so its events stay queryable
  // apart from the generic queue stream.
  const surroundLogger = logger?.child?.({ app: 'surround', module: 'queue-router' }) ?? logger;
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
      logger.warn?.('queue.source.unknown', { compoundId, source: resolvedSource, ip: req.ip });
      return res.status(404).json({ error: `Unknown source: ${resolvedSource}` });
    }

    if (!adapter.resolvePlayables) {
      logger.warn?.('queue.source.no_playables', { compoundId, source: resolvedSource, ip: req.ip });
      return res.status(400).json({
        error: 'Source does not support queue resolution',
        source: resolvedSource
      });
    }

    const playables = await adapter.resolvePlayables(finalId);
    const audioConfig = playables.audio || null;

    let items = await queueService.resolveQueue(playables, resolvedSource, { shuffle });

    // THIS is where a media item learns it is a part rather than a whole work:
    // the queue request names the container, the play request does not, and
    // that difference — not the id — is what decides which frame it gets. It
    // runs before `limit` on purpose, so a truncated queue keeps the
    // programme's FIRST parts rather than the first parts of whatever order
    // the adapter happened to return.
    const surroundPlan = surroundPlanner?.({
      surroundStore,
      containerId: finalId,
      items,
      enforceOrder: surroundEnforceOrder,
      logger: surroundLogger
    }) ?? null;
    if (surroundPlan) items = surroundPlan.items;

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

    // Enrichment lives here, not in toQueueItem: that mapper stays pure and
    // storage-unaware. Per item, so one bad sidecar can never cost the queue.
    for (const qi of queueItems) {
      try {
        // A container's rail outranks an item's claim on itself, so the plan is
        // asked first. It becomes the ONLY source exactly when it REFUSED —
        // falling through to the per-item lookup there would hand each episode
        // its own standalone frame, which is the rail-that-lies the refusal
        // exists to prevent. An item merely absent from a successful plan was
        // refused nothing, and keeps the sidecar it has always had: a container
        // naming three of a collection's ten items leaves the other seven be.
        const part = surroundPlan?.surroundFor.get(qi.contentId) ?? null;
        const surround = part?.payload
          ?? (surroundPlan?.refused ? null : surroundStore?.lookup(qi.contentId, qi.title));
        if (surround) {
          qi.surround = surround;
          if (part) {
            qi.surroundPart = part.part;
            // A PROGRAMME STARTS AT THE TOP OF EACH WORK. Every part is its own
            // media item with its own saved playhead, so a season played end to
            // end dropped into the middle of part two — wherever that episode
            // was last abandoned — while the rail, which is right, drew the
            // playhead a third of the way along a work that had just started.
            // Resume is a fact about watching ONE thing; `parts:` is the
            // statement that these seven are one thing, and it outranks it.
            //
            // The SUPPRESSION is all that happens here: `watchProgress` still
            // reports what the file has seen, and playing that episode on its
            // own resumes exactly as it always did — this is the container's
            // reading of it, not a rewrite of the watch state.
            qi.resumePosition = null;
            qi.resume = false;
          }
          surroundLogger?.debug?.('surround.attach', {
            contentId: qi.contentId,
            surroundId: surround.id,
            path: 'queue',
            ...(part ? { containerId: finalId, part: part.part } : {})
          });
        }
      } catch (err) {
        surroundLogger?.warn?.('surround.attach.failed', { contentId: qi.contentId, error: err?.message });
      }
    }

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
