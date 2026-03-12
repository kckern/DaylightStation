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
 * @param {Object} config.notificationService - NotificationService instance
 * @param {Object} config.preferenceStore - INotificationPreferenceStore implementation
 * @param {Object} [config.logger]
 * @returns {Router}
 */
export default function createNotificationRouter(config) {
  const { notificationService, preferenceStore, logger } = config;

  const router = Router();

  /**
   * GET /preferences
   * Get user's notification preferences
   */
  router.get('/preferences', async (req, res, next) => {
    try {
      const username = req.query.username || 'default';
      const prefs = await preferenceStore?.load(username);
      res.json(prefs?.toJSON() || {});
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
      await preferenceStore?.save(username, req.body);
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
    const pending = notificationService?.getPending() || [];
    res.json({ pending });
  });

  /**
   * POST /dismiss/:index
   * Dismiss a pending notification
   */
  router.post('/dismiss/:index', (req, res) => {
    const index = parseInt(req.params.index, 10);
    const dismissed = notificationService?.dismiss(index) || false;
    res.json({ dismissed });
  });

  return router;
}
