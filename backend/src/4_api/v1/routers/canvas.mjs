/**
 * Canvas Router
 *
 * API endpoints for canvas art display:
 * - GET /current - Get current art for device
 * - POST /next - Advance to next art
 * - POST /rotation/start - Start auto-rotation
 * - POST /rotation/stop - Stop auto-rotation
 * - GET /image/* - Serve canvas image files
 *
 * @module api/v1/routers
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs';

/**
 * Create canvas API router
 * @param {Object} deps
 * @param {Object} deps.canvasService - CanvasService instance
 * @returns {Router}
 */
export function createCanvasRouter({ canvasService }) {
  const router = Router();

  /**
   * GET /current - Get current art for device
   */
  router.get('/current', async (req, res, next) => {
    try {
      const { deviceId } = req.query;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      const householdId = req.householdId;
      const item = await canvasService.getCurrent(deviceId, householdId);

      if (!item) {
        return res.status(404).json({ error: 'No art available' });
      }

      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /next - Advance to next art
   */
  router.post('/next', async (req, res, next) => {
    try {
      const { deviceId } = req.body;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      const householdId = req.householdId;
      const item = await canvasService.getCurrent(deviceId, householdId);

      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /rotation/start - Start rotation for device
   */
  router.post('/rotation/start', async (req, res, next) => {
    try {
      const { deviceId } = req.body;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      const householdId = req.householdId;
      await canvasService.startRotation(deviceId, householdId);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /rotation/stop - Stop rotation for device
   */
  router.post('/rotation/stop', async (req, res, next) => {
    try {
      const { deviceId } = req.body;

      if (!deviceId) {
        return res.status(400).json({ error: 'deviceId is required' });
      }

      canvasService.stopRotation(deviceId);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /image/* - Serve canvas image
   */
  router.get('/image/*', async (req, res, next) => {
    try {
      const imagePath = req.params[0];

      // Get canvas service to access config
      const canvasService = req.app.get('canvasService');
      if (!canvasService) {
        return res.status(503).json({ error: 'Canvas service not configured' });
      }

      // Get basePath from the adapter (injected at bootstrap)
      const basePath = req.app.get('canvasBasePath');
      if (!basePath) {
        return res.status(503).json({ error: 'Canvas basePath not configured' });
      }

      const fullPath = path.join(basePath, imagePath);

      // Security: ensure path is within basePath (prevent traversal)
      const resolvedPath = path.resolve(fullPath);
      const resolvedBase = path.resolve(basePath);
      if (!resolvedPath.startsWith(resolvedBase)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      // Check file exists
      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: 'Image not found', path: imagePath });
      }

      res.sendFile(resolvedPath);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createCanvasRouter;
