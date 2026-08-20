// backend/src/3_applications/content/services/PlayResponseService.mjs

import { resolveFormat } from '#domains/content/utils/resolveFormat.mjs';
import { MediaProgress } from '#domains/content/entities/MediaProgress.mjs';

/**
 * PlayResponseService
 *
 * Application-layer service that builds play responses and reconciles
 * watch state for media items. Extracted from the play API router so the
 * router remains a thin HTTP layer.
 *
 * Responsibilities:
 * - Transform internal content items to legacy-compatible play responses
 * - Reconcile watch state (local memory vs progress sync)
 * - Field mapping, metadata enrichment, format resolution
 *
 * What this service does NOT own:
 * - HTTP request/response handling
 * - Route matching or parameter parsing
 * - Adapter selection or content ID resolution
 */
export class PlayResponseService {
  #mediaProgressMemory;
  #progressSyncService;
  #progressSyncSources;
  #surroundStore;
  #surroundLogger;

  /**
   * @param {Object} deps
   * @param {Object} deps.mediaProgressMemory - MediaProgressMemory for local watch state
   * @param {Object} [deps.progressSyncService] - ProgressSyncService for remote sync
   * @param {Set} [deps.progressSyncSources] - Sources that use progress sync
   * @param {import('#apps/content/ports/ISurroundStore.mjs').ISurroundStore} [deps.surroundStore]
   *   Surround sidecar lookup. Optional: when absent, play responses are built
   *   exactly as before. Depended on as the port, never as a concrete store.
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ mediaProgressMemory, progressSyncService, progressSyncSources, surroundStore, logger }) {
    this.#mediaProgressMemory = mediaProgressMemory;
    this.#progressSyncService = progressSyncService ?? null;
    this.#progressSyncSources = progressSyncSources ?? null;
    this.#surroundStore = surroundStore ?? null;
    // Surround gets its own subsystem identity so its events are queryable
    // apart from the generic content-api stream.
    this.#surroundLogger = logger?.child?.({ app: 'surround', module: 'play-response' }) ?? logger ?? null;
  }

  /**
   * Transform internal item to legacy-compatible play response.
   *
   * Handles format resolution, resume position from watch state,
   * legacy field mapping for Plex items, and pass-through of
   * readalong/singalong content fields.
   *
   * @param {Object} item - Content item from adapter
   * @param {Object|null} watchState - Watch state (from getWatchState)
   * @param {Object} [options]
   * @param {Object} [options.adapter] - Content adapter instance (for format resolution)
   * @param {string|null} [options.session] - Opaque client session the caller
   *   put on the wire as `?session=`. Threaded into the returned Plex stream
   *   url so the media element carries it to the proxy route.
   * @param {string|null} [options.containerId] - The container playback was
   *   started FROM, when it was started from one. Absent for a direct play of a
   *   media item, which is what keeps a standalone étude a whole work.
   * @returns {Object} Play response DTO
   */
  toPlayResponse(item, watchState = null, { adapter, resume, session = null, containerId = null } = {}) {
    const response = {
      id: item.id,
      assetId: item.id,
      mediaUrl: item.mediaUrl,
      mediaType: item.mediaType,
      format: resolveFormat(item, adapter),
      title: item.title,
      duration: item.duration,
      resumable: item.resumable ?? false,
      thumbnail: item.thumbnail,
      image: item.thumbnail,
      metadata: item.metadata
    };

    // Add resume position if in progress (use domain entity)
    // Skip if resume explicitly disabled (e.g., list items with resume: false)
    if (resume !== false && response.resumable && watchState?.playhead > 0 && watchState?.duration > 0) {
      const progress = new MediaProgress(watchState);
      if (progress.isInProgress()) {
        response.resume_position = progress.playhead;
        response.resume_percent = progress.percent;

        // For Plex DASH streams, append offset so Plex starts transcoding at
        // the resume position — avoids client-side seeking which corrupts buffers.
        if (response.mediaUrl && response.mediaUrl.includes('/proxy/plex/stream/')) {
          const sep = response.mediaUrl.includes('?') ? '&' : '?';
          response.mediaUrl = `${response.mediaUrl}${sep}offset=${Math.floor(progress.playhead)}`;
        }
      }
    }

    // Plex stream urls carry the client session.
    //
    // It rides in the URL rather than a header because the request is issued by
    // the <video>/dash element itself, and a media element cannot be given
    // custom headers. Without it the proxy route has nothing to pass to Plex
    // and PlexAdapter mints a fresh random identifier per request — which is
    // how one tablet retrying came to look like 495 distinct Plex clients.
    if (typeof response.mediaUrl === 'string' && response.mediaUrl.includes('/proxy/plex/stream/')) {
      // Two absences, deliberately kept apart:
      //   field missing  → this response is not a Plex stream at all
      //   field === null → it is, but the caller sent no `?session=`, so Plex
      //                    will see a fresh random client for every request
      response.plexClientIdentifier = typeof adapter?.resolveClientIdentifier === 'function'
        ? adapter.resolveClientIdentifier(session)
        : null;

      if (session) {
        const sep = response.mediaUrl.includes('?') ? '&' : '?';
        // Encoded on our own hop; the proxy route decodes it back to the exact
        // bytes the caller sent, and the adapter applies Plex's character-set
        // constraint at the boundary that owns it.
        response.mediaUrl = `${response.mediaUrl}${sep}session=${encodeURIComponent(session)}`;
      }
    }

    // Include type from item for CSS resolution (talk, scripture, etc.)
    if (item.type) response.type = item.type;

    // Set videoUrl when media is video (readalong scrollers check this field)
    if (item.mediaType === 'video' && item.mediaUrl) {
      response.videoUrl = item.mediaUrl;
    }

    // Pass through content/style/subtitle/ambientUrl for readalong/singalong scrollers
    // Content may be on item directly or nested in metadata (adapter-dependent)
    const contentData = item.content || item.metadata?.content;
    if (contentData) response.content = contentData;
    if (item.style || item.metadata?.style) response.style = item.style || item.metadata.style;
    if (item.subtitle || item.metadata?.speaker) response.subtitle = item.subtitle || item.metadata.speaker;
    if (item.ambientUrl) response.ambientUrl = item.ambientUrl;

    // Legacy field mapping for Plex items
    if (item.metadata) {
      if (item.metadata.grandparentTitle) response.grandparentTitle = item.metadata.grandparentTitle;
      if (item.metadata.parentTitle) response.parentTitle = item.metadata.parentTitle;
      if (item.metadata.type === 'episode') response.episode = item.title;
    }

    // Legacy field: expose localId under source key for backward compatibility
    const colonIdx = item.id.indexOf(':');
    if (colonIdx > 0) {
      const sourceKey = item.id.slice(0, colonIdx);
      response[sourceKey] = item.id.slice(colonIdx + 1);
    }

    // Surround is purely additive: an authored sidecar frames the player, and
    // its absence — or a store that breaks its never-throw contract — must
    // leave the response byte-identical to an un-enriched one.
    try {
      // A part of an enriched container gets the CONTAINER's frame, not its
      // own, and the container's claim has to be asked FIRST — an étude episode
      // has a perfectly good standalone sidecar of its own, so asking `lookup`
      // first would answer with it and the season's rail would never appear.
      //
      // The distinguishing signal is `containerId`: how playback started, never
      // the id. A direct play of the same episode passes none, falls straight
      // to `lookup`, and reads as a whole work exactly as it always has.
      const part = containerId ? this.#surroundStore?.lookupByPart?.(item.id) : null;
      const surround = part?.payload ?? this.#surroundStore?.lookup(item.id, item.title);
      if (surround) {
        response.surround = surround;
        if (part) response.surroundPart = part.part;
        this.#surroundLogger?.debug?.('surround.attach', {
          contentId: item.id,
          surroundId: surround.id,
          path: 'play',
          ...(part ? { containerId, part: part.part } : {})
        });
      }
    } catch (err) {
      this.#surroundLogger?.warn?.('surround.attach.failed', { contentId: item.id, error: err?.message });
    }

    return response;
  }

  /**
   * Get watch state for an item, using progress sync for items with a sync
   * service and falling back to local media progress memory.
   *
   * @param {Object} item - Content item (needs item.id)
   * @param {string} storagePath - Storage path for media progress lookup
   * @param {Object} [adapter] - Content adapter instance (checked for sync eligibility)
   * @returns {Promise<Object|null>} Watch state or null
   */
  async getWatchState(item, storagePath, adapter) {
    if (this.#progressSyncService && this.#progressSyncSources?.has(adapter?.source)) {
      const colonIdx = item.id.indexOf(':');
      const localId = colonIdx > 0 ? item.id.slice(colonIdx + 1) : item.id;
      return this.#progressSyncService.reconcileOnPlay(item.id, storagePath, localId);
    }
    return this.#mediaProgressMemory ? this.#mediaProgressMemory.get(item.id, storagePath) : null;
  }
}

export default PlayResponseService;
