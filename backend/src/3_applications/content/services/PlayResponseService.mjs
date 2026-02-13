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

  /**
   * @param {Object} deps
   * @param {Object} deps.mediaProgressMemory - MediaProgressMemory for local watch state
   * @param {Object} [deps.progressSyncService] - ProgressSyncService for remote sync
   * @param {Set} [deps.progressSyncSources] - Sources that use progress sync
   */
  constructor({ mediaProgressMemory, progressSyncService, progressSyncSources }) {
    this.#mediaProgressMemory = mediaProgressMemory;
    this.#progressSyncService = progressSyncService ?? null;
    this.#progressSyncSources = progressSyncSources ?? null;
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
   * @returns {Object} Play response DTO
   */
  toPlayResponse(item, watchState = null, { adapter } = {}) {
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
    if (watchState?.playhead > 0 && watchState?.duration > 0) {
      const progress = new MediaProgress(watchState);
      if (progress.isInProgress()) {
        response.resume_position = progress.playhead;
        response.resume_percent = progress.percent;
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
