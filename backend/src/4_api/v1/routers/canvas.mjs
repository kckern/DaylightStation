/**
 * Canvas Router
 *
 * API endpoints for canvas art display:
 * - GET /current - Get current art for device
 * - POST /next - Advance to next art
 * - POST /rotation/start - Start auto-rotation
 * - POST /rotation/stop - Stop auto-rotation
 *
 * @module api/v1/routers
 */
import { Router } from 'express';

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

  return router;
}

export default createCanvasRouter;
