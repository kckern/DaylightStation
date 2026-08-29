import express from 'express';
import { sendLocalFileResource } from '#system/http/streamFile.mjs';

/**
 * Status is mapped by ERROR NAME, not `instanceof`, and the unexpected case is
 * delegated to the app-wide `errorHandlerMiddleware`.
 *
 * Both are the sanctioned shape for this layer: `api-no-domains` forbids the
 * API layer importing domain error classes, and `errorHandler.mjs` exists to
 * be the one place that decides status — its own `getHttpStatusByName` says so
 * ("routers that cannot import domain classes stamp `err.status` by NAME at
 * their boundary"). A hand-rolled 500 here would also hide the trace id and
 * the structured logging that handler emits.
 */
const STATUS_BY_NAME = Object.freeze({ EntityNotFoundError: 404, ValidationError: 400 });

export function createLanguageReelsRouter({ service, grants, logger = console, sendFileResource = sendLocalFileResource } = {}) {
  const router = express.Router();
  const authorized = (req, res) => {
    const result = grants?.verify(req.get('X-School-Reel-Grant'), { learnerId: req.params.userId, reelId: req.params.reelId });
    if (!result?.ok) { res.status(403).json({ error: 'A current assigned-reel launch is required' }); return null; }
    return result.payload;
  };
  const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (error) {
    const status = STATUS_BY_NAME[error?.name];
    if (status) res.status(status).json({ error: error.message });
    else { logger.error?.('school.language-reels.router.error', { error: error.message, path: req.path }); next(error); }
  } };
  router.get('/users/:userId/reels/:reelId', wrap((req, res) => {
    const grant = authorized(req, res); if (!grant) return;
    const session = service.open({ userId: grant.learnerId, reelId: grant.reelId });
    if (grant.revision !== session.revision) { res.status(403).json({ error: 'This reel changed. Open it again from your assignment.' }); return; }
    res.json({ session: { ...session, reel: undefined }, reel: session.reel,
      mediaUrl: `/api/v1/school/language-reels/media/${encodeURIComponent(grant.reelId)}?grant=${encodeURIComponent(req.get('X-School-Reel-Grant'))}` });
  }));
  router.post('/users/:userId/reels/:reelId/stages/:stage', express.json(), wrap((req, res) => {
    const grant = authorized(req, res); if (!grant) return;
    res.json(service.markStage({ userId: grant.learnerId, reelId: grant.reelId, stage: req.params.stage }));
  }));
  router.post('/users/:userId/reels/:reelId/attempts', express.json(), wrap((req, res) => {
    const grant = authorized(req, res); if (!grant) return;
    res.json(service.recordAttempt({ userId: grant.learnerId, reelId: grant.reelId, ...req.body }));
  }));
  router.get('/media/:reelId', wrap((req, res) => {
    const result = grants?.verify(req.query.grant, { reelId: req.params.reelId });
    if (!result?.ok) { res.status(403).end(); return; }
    if (result.payload.revision !== service.getReel(req.params.reelId).revision) { res.status(403).end(); return; }
    const resource = service.mediaResource(req.params.reelId); if (!resource) { res.status(404).end(); return; }
    res.set('Cache-Control', 'private, no-store'); return sendFileResource(req, res, resource);
  }));
  return router;
}
export default createLanguageReelsRouter;
