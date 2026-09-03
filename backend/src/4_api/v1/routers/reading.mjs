/** Living-room reading session HTTP translation. */
import express from 'express';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';

const trimmed = value => typeof value === 'string' && value.trim() ? value.trim() : null;

function badRequest(message) {
  const err = new Error(message);
  err.name = 'ValidationError';
  err.status = 400;
  return err;
}

export function createReadingRouter({ readingService } = {}) {
  const router = express.Router();

  router.get('/session', asyncHandler(async (req, res) => {
    const location = trimmed(req.query?.location);
    if (!location) throw badRequest('location is required');
    return res.json(readingService.session(location));
  }));

  router.post('/session/ack', asyncHandler(async (req, res) => {
    const location = trimmed(req.body?.location);
    const sessionId = trimmed(req.body?.sessionId);
    if (!location || !sessionId) throw badRequest('location and sessionId are required');
    const presentationId = trimmed(req.body?.presentationId);
    const learnerId = trimmed(req.body?.learnerId);
    const revision = Number(req.body?.revision);
    const serverEpoch = trimmed(req.body?.serverEpoch);
    // Legacy session-only ACKs stay valid for already-committed snapshots. A
    // presentation-aware client must prove the entire candidate version.
    const proof = presentationId
      ? { sessionId, presentationId, learnerId, revision, serverEpoch }
      : sessionId;
    if (presentationId && (!learnerId || !Number.isFinite(revision) || !serverEpoch)) {
      throw badRequest('presentationId, learnerId, revision, and serverEpoch are required together');
    }
    const result = readingService.acknowledge(location, proof);
    if (!result.ok && presentationId) return res.status(409).json({ ok: false, reason: 'stale-presentation' });
    return res.json(result);
  }));

  router.get('/events', asyncHandler(async (req, res) => {
    const location = trimmed(req.query?.location);
    if (!location) throw badRequest('location is required');
    return res.json(await readingService.events(location, Number(req.query?.limit)));
  }));

  router.post('/progress', asyncHandler(async (req, res) => {
    const result = readingService.progress({
      location: trimmed(req.body?.location),
      sessionId: trimmed(req.body?.sessionId),
      pickId: trimmed(req.body?.pickId),
      positionSec: Number(req.body?.positionSec),
      durationSec: Number(req.body?.durationSec),
      paused: req.body?.paused,
    });
    if (result.kind === 'mismatch') return res.status(409).json({ ok: false, reason: 'session-or-pick-mismatch' });
    return res.json({ ok: true, session: result.session });
  }));

  router.get('/read-status', asyncHandler(async (req, res) => {
    const learnerId = trimmed(req.query?.learnerId);
    const studyDay = trimmed(req.query?.studyDay);
    const pickId = trimmed(req.query?.pickId);
    if (!learnerId || !studyDay || !pickId) throw badRequest('learnerId, studyDay, and pickId are required');
    return res.json(await readingService.readStatus(learnerId, studyDay, pickId));
  }));

  router.post('/playing', asyncHandler(async (req, res) => {
    const location = trimmed(req.body?.location);
    if (!location) throw badRequest('location is required to report playback');
    const result = readingService.playing({
      location,
      learnerId: trimmed(req.body?.learnerId),
      contentId: trimmed(req.body?.contentId),
      pickId: trimmed(req.body?.pickId),
    });
    if (result.kind === 'pick_mismatch') return res.status(409).json({ ok: false, reason: 'pick-mismatch' });
    if (result.kind === 'no_session') return res.json({ ok: false, reason: 'no-session', state: null });
    return res.json({ ok: true, state: result.state, learnerId: result.learnerId });
  }));

  router.post('/read', asyncHandler(async (req, res) => {
    const result = await readingService.read(req.body || {});
    if (result.kind === 'session_expired') return res.status(409).json({ recorded: false, reason: 'session-or-pick-expired' });
    if (result.kind === 'pick_mismatch') return res.status(409).json({ recorded: false, reason: 'pick-mismatch' });
    return res.json({ recorded: true, read: result.read, presentation: result.presentation ?? null });
  }));

  router.get('/summary', asyncHandler(async (req, res) => {
    const learnerId = trimmed(req.query?.learnerId);
    if (!learnerId) throw badRequest('learnerId is required');
    return res.json(await readingService.summary(learnerId));
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export default createReadingRouter;
