import express from 'express';
import { EntityNotFoundError, ValidationError } from '#domains/core/errors/index.mjs';

export function createLanguageReelsRouter({ service, grants, logger = console } = {}) {
  const router = express.Router();
  const authorized = (req, res) => {
    const result = grants?.verify(req.get('X-School-Reel-Grant'), { learnerId: req.params.userId, reelId: req.params.reelId });
    if (!result?.ok) { res.status(403).json({ error: 'A current assigned-reel launch is required' }); return null; }
    return result.payload;
  };
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (error) {
    if (error instanceof EntityNotFoundError) res.status(404).json({ error: error.message });
    else if (error instanceof ValidationError) res.status(400).json({ error: error.message });
    else { logger.error?.('school.language-reels.router.error', { error: error.message, path: req.path }); res.status(500).json({ error: 'internal' }); }
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
    const file = service.mediaPath(req.params.reelId); if (!file) { res.status(404).end(); return; }
    res.set('Cache-Control', 'private, no-store'); res.sendFile(file);
  }));
  return router;
}
export default createLanguageReelsRouter;
