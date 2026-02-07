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

/**
 * Derive capabilities from item properties.
 *
 * @param {Object} item - The item to analyze
 * @returns {string[]} Array of capability strings
 */
function deriveCapabilities(item) {
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
  if (item.items || item.itemType === 'container') {
    capabilities.push('listable');
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
 * @returns {Object} Formatted response object
 */
function transformToInfoResponse(item, source) {
  const response = {
    contentId: item.id,  // Compound ID (e.g., "plex:12345") — unified identifier
    id: item.id,
    source,
    type: item.metadata?.type || item.type || null,
    title: item.title,
    capabilities: deriveCapabilities(item),
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
  if (item.content) response.content = item.content;

  // Pass through style for readalong/singalong scrollers
  if (item.style) response.style = item.style;

  // Pass through subtitle for readalong/singalong content
  if (item.subtitle) response.subtitle = item.subtitle;

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
  const { registry, contentQueryService, logger = console } = config;
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

    // Get adapter from registry - try direct match first, then prefix resolution
    let adapter = registry.get(resolvedSource);
    let finalLocalId = localId;
    let usePrefixResolution = false;

    if (!adapter) {
      // Try prefix-based resolution (e.g., media:sfx/intro, watchlist:comefollowme2025)
      const resolved = registry.resolveFromPrefix(resolvedSource, localId);
      if (resolved) {
        adapter = resolved.adapter;
        finalLocalId = resolved.localId;
        usePrefixResolution = true;
      }
    }

    if (!adapter) {
      return res.status(404).json({
        error: `Unknown source: ${resolvedSource || source}`
      });
    }

    // Fetch item from adapter
    // When using prefix resolution, pass localId directly (adapter handles ID format)
    // Otherwise, use the compound ID from the parser
    const item = await adapter.getItem(usePrefixResolution ? finalLocalId : compoundId);
    if (!item) {
      return res.status(404).json({
        error: 'Item not found',
        source: resolvedSource,
        localId
      });
    }

    // Transform and return response
    const response = transformToInfoResponse(item, resolvedSource);

    // For container items, include children as `items`
    if (item.itemType === 'container' && adapter.getList) {
      const lookupId = usePrefixResolution ? finalLocalId : compoundId;
      const result = await adapter.getList(lookupId);
      const children = Array.isArray(result) ? result : (result?.children || []);
      response.items = children.map(child => {
        const childResponse = transformToInfoResponse(child, child.source || resolvedSource);
        // When accessed via prefix (e.g., media:clips), remap child IDs to use the user-facing prefix
        if (usePrefixResolution && child.localId) {
          childResponse.id = `${resolvedSource}:${child.localId}`;
          childResponse.contentId = childResponse.id;
          childResponse.source = resolvedSource;
        }
        return childResponse;
      });
    }

    logger.info?.('info.get', {
      source: resolvedSource,
      localId,
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
