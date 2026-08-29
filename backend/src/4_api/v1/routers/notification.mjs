/**
 * Notification API Router
 *
 * Endpoints:
 * - GET /api/v1/notification/preferences       - Get user notification preferences
 * - PATCH /api/v1/notification/preferences     - Update preferences
 * - GET /api/v1/notification/pending           - Get undelivered in-app notifications
 * - POST /api/v1/notification/dismiss/:index   - Dismiss a pending notification
 *
 * @module api/v1/routers/notification
 */

import { Router } from 'express';

/**
 * Create notification API router
 *
 * @param {Object} config
 * @param {Object} config.notificationOperations
 * @param {Object} [config.logger]
 * @returns {Router}
 */
export default function createNotificationRouter(config) {
  const { notificationOperations } = config;

  const router = Router();

  /**
   * GET /preferences
   * Get user's notification preferences
   */
  router.get('/preferences', async (req, res, next) => {
    try {
      const username = req.query.username || 'default';
      res.json(await notificationOperations?.readPreferences?.(username) || {});
    } catch (error) {
      next(error);
    }
  });

  /**
   * PATCH /preferences
   * Update notification preferences
   */
  router.patch('/preferences', async (req, res, next) => {
    try {
      const username = req.query.username || 'default';
      await notificationOperations?.savePreferences?.(username, req.body);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /pending
   * Get undelivered in-app notifications
   */
  router.get('/pending', (req, res) => {
    const pending = notificationOperations?.pending?.() || [];
    res.json({ pending });
  });

  /**
   * POST /dismiss/:index
   * Dismiss a pending notification
   */
  router.post('/dismiss/:index', (req, res) => {
    const index = parseInt(req.params.index, 10);
    const dismissed = notificationOperations?.dismiss?.(index) || false;
    res.json({ dismissed });
  });

  return router;
}
