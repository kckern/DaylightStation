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
export const PROXY_ORIGIN_MAX_PER_MIN = 10;

export function createMediaSourceRouter({ mediaSourceHealer = null, logger = console, clock = () => Date.now() }) {
  const router = express.Router();
  // `origin: 'proxy'` makes the healer touch the media host (a chmod), and the
  // client claims it. A flood of distinct contentIds must not become a flood of
  // host heals, so claims are capped globally; past the cap the check still
  // runs, just without the claim.
  // Claims are counted per contentId: one stuck client re-asking about the same
  // item holds ONE slot, so it cannot starve other items' claims.
  const proxyClaims = new Map(); // contentId -> time of the slot's first claim
  const takeProxyClaim = (contentId) => {
    const now = clock();
    for (const [id, at] of proxyClaims) {
      if (now - at >= 60_000) proxyClaims.delete(id);
    }
    if (proxyClaims.has(contentId)) return true;
    if (proxyClaims.size >= PROXY_ORIGIN_MAX_PER_MIN) return false;
    proxyClaims.set(contentId, now);
    return true;
  };

  router.post('/check', async (req, res) => {
    if (!mediaSourceHealer) {
      return res.json({ state: 'unknown', reason: 'healer-not-configured', steps: [] });
    }
    const { contentId, deviceId = null, origin = null } = req.body || {};
    if (!contentId || typeof contentId !== 'string') {
      return res.status(400).json({ error: 'contentId is required' });
    }
    try {
      const result = await mediaSourceHealer.check(contentId, {
        deviceId,
        // Only 'proxy' is meaningful: the Player saw the proxy refuse the file,
        // so the healer refreshes it on the host even if Plex says readable.
        origin: origin === 'proxy' && takeProxyClaim(contentId) ? 'proxy' : null,
      });
      return res.json(result);
    } catch (error) {
      logger.error?.('media.source.check.failed', { contentId, error: error.message });
      return sendInternalError(res, { error: 'source check failed' });
    }
  });

  return router;
}

export default createMediaSourceRouter;
