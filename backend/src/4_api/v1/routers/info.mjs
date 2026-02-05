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
 *
 * @param {Object} item - The raw item from adapter
 * @param {string} source - The resolved source name
 * @returns {Object} Formatted response object
 */
function transformToInfoResponse(item, source) {
  return {
    id: item.id,
    source,
    type: item.type,
    title: item.title,
    capabilities: deriveCapabilities(item),
    metadata: item.metadata || {}
  };
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

    // Get adapter from registry
    const adapter = registry.get(resolvedSource);
    if (!adapter) {
      return res.status(404).json({
        error: `Unknown source: ${resolvedSource || source}`
      });
    }

    // Fetch item from adapter
    const item = await adapter.getItem(compoundId);
    if (!item) {
      return res.status(404).json({
        error: 'Item not found',
        source: resolvedSource,
        localId
      });
    }

    // Transform and return response
    const response = transformToInfoResponse(item, resolvedSource);

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
