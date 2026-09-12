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
export function createPlaySessionsRouter({ recordObservation = null, sessions = null, trackers = [], watchdog = null, grantLedger = null, grantPlayTime = null, checkEligibility = null, summarisePlayUsage = null, logger = console }) {
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
    res.json({
      devices: trackers.flatMap((tracker) => tracker.getHealth()),
      // Devices the meter has lost sight of for long enough that no NEW play
      // should be granted on them. Nothing here stops a game already running.
      blocked: watchdog?.blockedDevices?.() ?? [],
    });
  });

  /**
   * GET /devices/:deviceId/history?since=ISO — sessions on a device.
   *
   * Played time became money, so the record has to be answerable: who played
   * what, for how long, against which authorisation, and how precisely that was
   * measured.
   */
  router.get('/devices/:deviceId/history', async (req, res) => {
    if (!sessions?.listForDeviceSince) {
      return res.status(503).json({ error: 'Play-session metering is not configured' });
    }
    const since = req.query.since || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    if (Number.isNaN(Date.parse(since))) {
      return res.status(400).json({ error: 'since must be an ISO instant' });
    }
    try {
      const found = await sessions.listForDeviceSince(req.params.deviceId, since);
      return res.json({
        deviceId: req.params.deviceId,
        since,
        sessions: found.map((session) => session.toSnapshot()),
      });
    } catch (error) {
      logger.error?.('play.api.history_failed', { deviceId: req.params.deviceId, error: error.message });
      return sendInternalError(res, { error: 'Failed to read play history' });
    }
  });

  /**
   * POST /grants — give a child play time, extend it, or take it back.
   *
   * All three are one operation: an entry on an append-only ledger. Revoking
   * writes a negative delta so the grant AND the revocation stay visible, where
   * editing a balance would leave neither.
   */
  router.post('/grants', async (req, res) => {
    if (!grantPlayTime) return res.status(503).json({ error: 'Play-time grants are not configured' });
    const { userId, minutes, by = null, reason = null, on = null } = req.body || {};
    if (!userId || !Number.isFinite(Number(minutes))) {
      return res.status(400).json({ error: 'userId and a numeric minutes are required' });
    }
    try {
      return res.json(await grantPlayTime.execute({ userId, minutes: Number(minutes), by, reason, on }));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  /** GET /grants/:userId — today's granted time and how it was arrived at. */
  router.get('/grants/:userId', async (req, res) => {
    if (!grantLedger) return res.status(503).json({ error: 'Play-time grants are not configured' });
    const on = req.query.on || new Date().toISOString().slice(0, 10);
    try {
      const { grantedMs, entries } = await grantLedger.forUserOn(req.params.userId, on);
      return res.json({ userId: req.params.userId, on, grantedMs, entries });
    } catch (error) {
      logger.error?.('play.api.grants_failed', { userId: req.params.userId, error: error.message });
      return sendInternalError(res, { error: 'Failed to read play grants' });
    }
  });

  /**
   * GET /usage?since=&until= — the usage ledger, rolled up.
   *
   * This is the monitoring surface: who played, what, for how long, on which
   * day, across every device. It exists so usage can be WATCHED before any
   * policy is written against it — you cannot set a sensible limit on a number
   * you have never seen.
   *
   * Reports PLAYED time, not the span a game was open. Those differ by whatever
   * was spent paused or idle at a title screen, and the difference is often most
   * of it, so a limit set against wall-clock would be a very different limit
   * from the one intended.
   */
  router.get('/usage', async (req, res) => {
    if (!summarisePlayUsage) return res.status(503).json({ error: 'Play-session recording is not configured' });
    const since = req.query.since || new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const until = req.query.until || null;
    if (Number.isNaN(Date.parse(since)) || (until && Number.isNaN(Date.parse(until)))) {
      return res.status(400).json({ error: 'since and until must be ISO instants' });
    }
    try {
      return res.json(await summarisePlayUsage.execute({ since, until }));
    } catch (error) {
      logger.error?.('play.api.usage_failed', { error: error.message });
      return sendInternalError(res, { error: 'Failed to read play usage' });
    }
  });

  /**
   * GET /eligibility — may play begin?
   *
   * Answers with reasons rather than a bare no. "No" with no explanation is what
   * makes a system feel arbitrary to a child, and the reason is what a parent
   * needs in order to disagree with it.
   */
  router.get('/eligibility', async (req, res) => {
    if (!checkEligibility) return res.json({ allowed: true, reasons: [] });
    const { userId = null, deviceId = null, contentId = null } = req.query || {};
    try {
      return res.json(await checkEligibility.execute({ userId, deviceId, contentId }));
    } catch (error) {
      logger.error?.('play.api.eligibility_failed', { error: error.message });
      return sendInternalError(res, { error: 'Failed to check play eligibility' });
    }
  });

  return router;
}

export default createPlaySessionsRouter;
