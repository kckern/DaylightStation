import express from 'express';
import { sendInternalError } from '#api/utils/internalError.mjs';

/**
 * HTTP surface for play sessions.
 *
 * Two jobs. It is the push ingress for play surfaces that report their own
 * lifecycle — the in-browser emulator, which knows exactly when it starts,
 * pauses and stops — and it exposes what is currently being played for admin and
 * diagnostic views.
 *
 * The ingress deliberately accepts the SAME observation shape the polled,
 * inferred source produces, and hands it to the SAME use case. A self-reporting
 * surface is not a special case; it is simply an observation with better
 * confidence. That is what keeps one meter behind both kinds of play surface.
 */
export function createPlaySessionsRouter({ recordObservation = null, sessions = null, trackers = [], logger = console }) {
  const router = express.Router();

  /**
   * POST /observations — a surface reports what it is doing.
   *
   * `confidenceMs: 0` is the honest default here: a surface reporting its own
   * lifecycle knows the instant exactly, unlike the polled source.
   */
  router.post('/observations', async (req, res) => {
    if (!recordObservation) {
      return res.status(503).json({ error: 'Play-session metering is not configured' });
    }
    const { deviceId, surface, userId = null, grantRef = null, observation } = req.body || {};
    if (!deviceId || !surface || !observation?.state) {
      return res.status(400).json({ error: 'deviceId, surface and observation.state are required' });
    }
    try {
      const result = await recordObservation.execute({
        deviceId,
        surface,
        userId,
        grantRef,
        observation: {
          state: observation.state,
          observedAt: observation.observedAt || new Date().toISOString(),
          confidenceMs: Number(observation.confidenceMs ?? 0),
          content: observation.content ?? null,
        },
      });
      return res.json({
        sessionId: result.session?.id ?? null,
        started: result.started,
        ended: result.ended?.id ?? null,
        switched: result.switched,
        playedMs: result.session?.playedMs ?? null,
      });
    } catch (error) {
      logger.error?.('play.api.observation_failed', { deviceId, error: error.message });
      return res.status(400).json({ error: error.message });
    }
  });

  /** GET /devices/:deviceId — what is on this device right now, if anything. */
  router.get('/devices/:deviceId', async (req, res) => {
    if (!sessions) return res.status(503).json({ error: 'Play-session metering is not configured' });
    try {
      const session = await sessions.findOpenForDevice(req.params.deviceId);
      if (!session) return res.json({ deviceId: req.params.deviceId, session: null });
      return res.json({ deviceId: req.params.deviceId, session: session.toSnapshot() });
    } catch (error) {
      logger.error?.('play.api.read_failed', { deviceId: req.params.deviceId, error: error.message });
      return sendInternalError(res, { error: 'Failed to read play session' });
    }
  });

  /**
   * GET /health — per-device observation health.
   *
   * Exposed because silence from a meter is indistinguishable from a quiet
   * house; this is how an operator tells the two apart without reading logs.
   */
  router.get('/health', (_req, res) => {
    res.json({ devices: trackers.flatMap((tracker) => tracker.getHealth()) });
  });

  return router;
}

export default createPlaySessionsRouter;
