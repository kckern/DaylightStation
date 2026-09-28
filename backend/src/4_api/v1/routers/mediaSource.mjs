import express from 'express';
import { sendInternalError } from '#api/utils/internalError.mjs';

/**
 * /api/v1/media-source — "can the media server read this file?"
 *
 * The Player calls `POST /check` when a media file is refused (a 404/503 from
 * the Plex proxy, or a startup that never produced a frame), then keeps calling
 * it with backoff while the answer is `unreadable`. Each call also runs the
 * MediaSourceHealer's repair ladder. See docs/reference/player/media-source-healing.md.
 */
export function createMediaSourceRouter({ mediaSourceHealer = null, logger = console }) {
  const router = express.Router();

  router.post('/check', async (req, res) => {
    if (!mediaSourceHealer) {
      return res.json({ state: 'unknown', reason: 'healer-not-configured', steps: [] });
    }
    const { contentId, deviceId = null } = req.body || {};
    if (!contentId || typeof contentId !== 'string') {
      return res.status(400).json({ error: 'contentId is required' });
    }
    try {
      const result = await mediaSourceHealer.check(contentId, { deviceId });
      return res.json(result);
    } catch (error) {
      logger.error?.('media.source.check.failed', { contentId, error: error.message });
      return sendInternalError(res, { error: 'source check failed' });
    }
  });

  return router;
}

export default createMediaSourceRouter;
