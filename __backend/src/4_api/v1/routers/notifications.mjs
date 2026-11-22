/**
 * Notifications API.
 *
 * POST /api/v1/notifications/actions
 *   { notificationId, actionId, reply?, username? } — a press on a notification
 *   action from the DaylightStation Android app or relayed by Home Assistant.
 *   200 {ok:true}; 400 BAD_REQUEST; 401 DEVICE_UNAUTHORIZED; 404 ACTION_UNKNOWN; 409 <handler code>;
 *   502 ACTION_FAILED when the owning app threw.
 */
import { Router } from 'express';
import express from 'express';

const ID = /^[A-Za-z0-9_.:-]{1,120}$/;
// Control characters other than tab and newline.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export function createNotificationsRouter({ respondToNotificationAction, logger } = {}) {
  const router = Router();

  router.post('/actions', express.json({ limit: '16kb' }), async (req, res) => {
    const { notificationId, actionId, reply = null, username = null } = req.body || {};
    const badReply = reply !== null && (typeof reply !== 'string' || reply.length > 1000 || CONTROL.test(reply));
    if (typeof notificationId !== 'string' || !notificationId || notificationId.length > 120
      || typeof actionId !== 'string' || !ID.test(actionId) || badReply
      || (username !== null && typeof username !== 'string')) {
      return res.status(400).json({ ok: false, code: 'BAD_REQUEST' });
    }
    try {
      const result = await respondToNotificationAction.execute({ notificationId, actionId, reply, username });
      if (result.ok) return res.json({ ok: true });
      const status = result.code === 'ACTION_UNKNOWN' ? 404 : result.code === 'DEVICE_UNAUTHORIZED' ? 401 : 409;
      return res.status(status).json({ ok: false, code: result.code });
    } catch (error) {
      logger?.error?.('notification.action.failed', { notificationId, actionId, error: error.message });
      return res.status(502).json({ ok: false, code: 'ACTION_FAILED' });
    }
  });

  return router;
}
