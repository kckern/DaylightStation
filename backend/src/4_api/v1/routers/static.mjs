/**
 * Static Assets Router
 *
 * Serves static image assets from configured paths:
 * - GET /api/static/entropy/:icon - Entropy status icons (svg/png)
 * - GET /api/static/art/* - Art images
 * - GET /api/static/users/:id - User avatar images
 * - GET /api/static/equipment/:id - Fitness equipment images
 *
 * @module api/routers/static
 */

import express from 'express';
import fs from 'fs';
import path from 'path';

/**
 * Create static assets router
 *
 * @param {Object} config
 * @param {string} config.imgBasePath - Base path for images (process.env.path.img)
 * @param {string} config.dataBasePath - Base path for data files
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createStaticRouter(config) {
  const { imgBasePath, dataBasePath, logger = console } = config;
  const router = express.Router();

  /**
   * Resolve file with extension fallback
   * Tries exact path, then common image extensions
   */
  const resolveImagePath = (basePath, relativePath, extensions = ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp']) => {
    // Try exact path first
    const exactPath = path.join(basePath, relativePath);
    if (fs.existsSync(exactPath) && fs.statSync(exactPath).isFile()) {
      return exactPath;
    }

    // Try with extensions
    for (const ext of extensions) {
      const withExt = `${exactPath}.${ext}`;
      if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
        return withExt;
      }
    }

    return null;
  };

  /**
   * Get MIME type from file extension
   */
  const getMimeType = (filePath) => {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mimeTypes = {
      svg: 'image/svg+xml',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  };

  /**
   * Send image file with caching headers
   */
  const sendImage = (res, filePath) => {
    const mimeType = getMimeType(filePath);
    const stat = fs.statSync(filePath);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day cache
    res.setHeader('Access-Control-Allow-Origin', '*');

    fs.createReadStream(filePath).pipe(res);
  };

  // ===========================================================================
  // Entropy Icons
  // ===========================================================================

  /**
   * GET /api/static/entropy/:icon
   * Serve entropy status icons (e.g., healthy.svg, warning.png)
   */
  router.get('/entropy/:icon', (req, res) => {
    const { icon } = req.params;
    const entropyDir = path.join(imgBasePath, 'entropy');

    const filePath = resolveImagePath(entropyDir, icon);
    if (!filePath) {
      return res.status(404).json({ error: 'Entropy icon not found', icon });
    }

    logger.debug?.('static.entropy.served', { icon, path: filePath });
    sendImage(res, filePath);
  });

  // ===========================================================================
  // Art Images
  // ===========================================================================

  /**
   * GET /api/static/art/*
   * Serve art images from the art directory
   */
  router.get('/art/*', (req, res) => {
    const relativePath = req.params[0] || '';
    const artDir = path.join(imgBasePath, 'art');

    const filePath = resolveImagePath(artDir, relativePath);
    if (!filePath) {
      return res.status(404).json({ error: 'Art image not found', path: relativePath });
    }

    logger.debug?.('static.art.served', { path: relativePath });
    sendImage(res, filePath);
  });

  // ===========================================================================
  // User Avatars
  // ===========================================================================

  /**
   * GET /api/static/users/:id
   * Serve user avatar images
   */
  router.get('/users/:id', (req, res) => {
    const { id } = req.params;
    const usersDir = path.join(imgBasePath, 'users');

    const filePath = resolveImagePath(usersDir, id);
    if (!filePath) {
      // Try default avatar
      const defaultPath = resolveImagePath(usersDir, 'default');
      if (defaultPath) {
        logger.debug?.('static.users.default', { id });
        return sendImage(res, defaultPath);
      }
      return res.status(404).json({ error: 'User avatar not found', id });
    }

    logger.debug?.('static.users.served', { id, path: filePath });
    sendImage(res, filePath);
  });

  // ===========================================================================
  // Fitness Equipment
  // ===========================================================================

  /**
   * GET /api/static/equipment/:id
   * Serve fitness equipment images
   */
  router.get('/equipment/:id', (req, res) => {
    const { id } = req.params;
    const equipmentDir = path.join(imgBasePath, 'equipment');

    const filePath = resolveImagePath(equipmentDir, id);
    if (!filePath) {
      // Try in fitness subdirectory
      const fitnessEquipDir = path.join(imgBasePath, 'fitness', 'equipment');
      const altPath = resolveImagePath(fitnessEquipDir, id);
      if (altPath) {
        logger.debug?.('static.equipment.served', { id, path: altPath });
        return sendImage(res, altPath);
      }
      return res.status(404).json({ error: 'Equipment image not found', id });
    }

    logger.debug?.('static.equipment.served', { id, path: filePath });
    sendImage(res, filePath);
  });

  // ===========================================================================
  // Generic Image Passthrough
  // ===========================================================================

  /**
   * GET /api/static/img/*
   * Generic image serving for backward compatibility
   */
  router.get('/img/*', (req, res) => {
    const relativePath = req.params[0] || '';

    const filePath = resolveImagePath(imgBasePath, relativePath);
    if (!filePath) {
      return res.status(404).json({ error: 'Image not found', path: relativePath });
    }

    logger.debug?.('static.img.served', { path: relativePath });
    sendImage(res, filePath);
  });

  return router;
}

export default createStaticRouter;
