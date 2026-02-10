/**
 * Info Router
 *
 * Provides item metadata retrieval with unified ID format support.
 * Replaces /item/ and /content/:source/info/ routes for metadata-only access.
 *
 * Supported formats:
 * - Path segments: /info/plex/12345
 * - Compound ID: /info/plex:12345
 * - Heuristic: /info/12345 (auto-detects plex)
 *
 * @module api/v1/routers/info
 */

import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { parseActionRouteId } from '../utils/actionRouteParser.mjs';
import { resolveFormat } from '../utils/resolveFormat.mjs';

/**
 * Derive capabilities from item properties.
 * Delegates to adapter if it implements getCapabilities(), otherwise uses generic fallback.
 *
 * @param {Object} item - The item to analyze
 * @param {Object} adapter - The content adapter for the item
 * @returns {string[]} Array of capability strings
 */
function deriveCapabilities(item, adapter) {
  // Prefer adapter-provided capabilities (proper DDD: domain knowledge stays in adapter)
  if (adapter?.getCapabilities && typeof adapter.getCapabilities === 'function') {
    return adapter.getCapabilities(item);
  }

  // Fallback: generic capability detection for adapters that don't implement getCapabilities yet
  const capabilities = [];

  // playable: can be played as video/audio
  if (item.mediaUrl) {
    capabilities.push('playable');
  }

  // displayable: has visual representation
  if (item.thumbnail || item.imageUrl) {
    capabilities.push('displayable');
  }

  // listable: is a container with children
  const isListable = item.items || item.itemType === 'container';
  if (isListable) {
    capabilities.push('listable');
  }

  // queueable: generic heuristic - containers with resolvePlayables capability
  if (isListable && adapter?.resolvePlayables) {
    capabilities.push('queueable');
  }

  // readable: has readable content (books, comics, documents)
  if (item.contentUrl || item.format) {
    capabilities.push('readable');
  }

  return capabilities;
}

/**
 * Transform item to standardized info response format.
 * Passes through playback-essential fields for PlayableItem instances.
 *
 * @param {Object} item - The raw item from adapter (PlayableItem or ListableItem)
 * @param {string} source - The resolved source name
 * @param {Object} adapter - The content adapter for the item
 * @returns {Object} Formatted response object
 */
function transformToInfoResponse(item, source, adapter) {
  const response = {
    contentId: item.id,  // Compound ID (e.g., "plex:12345") — unified identifier
    id: item.id,
    source,
    type: item.metadata?.type || item.type || null,
    title: item.title,
    format: resolveFormat(item, adapter),
    capabilities: deriveCapabilities(item, adapter),
    metadata: item.metadata || {}
  };

  // Pass through playback-essential fields from PlayableItem
  if (item.mediaUrl) response.mediaUrl = item.mediaUrl;
  if (item.videoUrl) response.videoUrl = item.videoUrl;
  if (item.ambientUrl) response.ambientUrl = item.ambientUrl;
  if (item.mediaType) response.mediaType = item.mediaType;
  if (item.duration != null) response.duration = item.duration;
  if (item.thumbnail) {
    response.thumbnail = item.thumbnail;
    response.image = item.thumbnail; // AudioPlayer uses image field
  }

  // Pass through displayable fields
  if (item.imageUrl) response.imageUrl = item.imageUrl;
  if (item.category) response.category = item.category;

  // Pass through content field for singalong/readalong scrollers
  // Content may be on item directly or nested in metadata (adapter-dependent)
  const contentData = item.content || item.metadata?.content;
  if (contentData) response.content = contentData;

  // Pass through style for readalong/singalong scrollers
  if (item.style || item.metadata?.style) response.style = item.style || item.metadata.style;

  // Pass through subtitle/speaker for readalong/singalong content
  if (item.subtitle || item.metadata?.speaker) response.subtitle = item.subtitle || item.metadata.speaker;

  // Expose plex key at top level for frontend compatibility
  if (source === 'plex' && item.metadata?.plex) {
    response.plex = String(item.metadata.plex);
  } else if (source === 'plex' && item.localId) {
    response.plex = String(item.localId);
  }

  return response;
}

/**
 * Create info router for item metadata retrieval.
 *
 * @param {Object} config - Router configuration
 * @param {Object} config.registry - Content source registry
 * @param {Object} [config.contentQueryService] - Optional content query service
 * @param {Object} [config.logger] - Logger instance (defaults to console)
 * @returns {express.Router} Express router instance
 */
export function createInfoRouter(config) {
  const { registry, contentQueryService, contentIdResolver, logger = console } = config;
  const router = express.Router();

  /**
   * Handler for info requests.
   *
   * Supports:
   * - /info/plex/12345 (path segments)
   * - /info/plex:12345 (compound ID)
   * - /info/12345 (heuristic detection)
   */
  const handleInfoRequest = asyncHandler(async (req, res) => {
    const { source } = req.params;
    const rawPath = req.params[0] || '';

    // Parse the ID using unified parser
    const { source: resolvedSource, localId, compoundId } = parseActionRouteId({
      source,
      path: rawPath
    });

    // Resolve content ID through unified resolver (handles all layers:
    // exact source, prefix resolution, system aliases, household aliases)
    const resolved = contentIdResolver.resolve(compoundId);

    if (!resolved?.adapter) {
      return res.status(404).json({
        error: `Unknown source: ${resolvedSource || source}`
      });
    }

    const adapter = resolved.adapter;
    const finalSource = resolved.source;
    const finalLocalId = resolved.localId;

    // Fetch item from adapter using resolved localId
    const item = await adapter.getItem(finalLocalId);
    if (!item) {
      return res.status(404).json({
        error: 'Item not found',
        source: finalSource,
        localId: finalLocalId
      });
    }

    // Transform response with capability evaluation.
    // Use resolved source (not parser source) to get correct format from adapter.
    const response = transformToInfoResponse(item, finalSource, adapter);

    // For container items, prefer metadata childCount over expensive getList() call
    if (item.itemType === 'container') {
      response.itemCount = item.metadata?.childCount ?? item.metadata?.leafCount ?? 0;
    }

    logger.info?.('info.get', {
      source: finalSource,
      localId: finalLocalId,
      capabilities: response.capabilities
    });

    res.json(response);
  });

  // Register routes: order matters - more specific first
  // GET /:source/* - handles path segments like /plex/12345
  router.get('/:source/*', handleInfoRequest);

  // GET /:source - handles compound IDs like /plex:12345 and heuristics like /12345
  router.get('/:source', handleInfoRequest);

  return router;
}

export default createInfoRouter;
