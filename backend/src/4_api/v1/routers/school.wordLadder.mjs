/**
 * `/word-ladder/…` (mastery redesign §4 API, §8 test mode). Mounted twice:
 * live, and `/word-ladder/test` over the read-only shadow service. A thin
 * shell — every rule lives in WordLadderSittingService. Responses are
 * `private, no-store`: a child's sitting must not sit in a shared cache.
 */
import express from 'express';

// A spoken take arrives as the raw request body (MediaRecorder output).
const rawAudio = express.raw({ type: ['audio/webm', 'audio/ogg', 'audio/mp4', 'application/octet-stream'], limit: '10mb' });

export function mountWordLadderRoutes({
  router, wrap, notConfigured, wordLadderStudy = null, wordLadderTest = null, stageScreen = null,
}) {
  const noStore = (res) => res.set('Cache-Control', 'private, no-store');
  const mount = (base, getService, { test }) => {
    const service = () => {
      const s = getService();
      if (!s) throw notConfigured(test ? 'word-ladder test mode' : 'word-ladder');
      return s;
    };
    router.post(`${base}/open`, wrap(async (req, res) => {
      const { userId, deckId, scenario = null, capabilities } = req.body || {};
      noStore(res).json(await service().open(test ? { userId, deckId, scenario, capabilities } : { userId, deckId, capabilities }));
    }));
    // Speaking steps only; the test mount's service keeps nothing (discarding sink).
    router.post(`${base}/sittings/:sittingId/recordings/:itemId`, rawAudio, wrap(async (req, res) => {
      noStore(res).json(await service().saveRecording({
        userId: req.query.userId, sittingId: req.params.sittingId, itemId: req.params.itemId,
        buffer: Buffer.isBuffer(req.body) ? req.body : null, ext: req.query.ext ?? 'webm',
      }));
    }));
    router.post(`${base}/sittings/:sittingId/practice`, wrap(async (req, res) => {
      const {
        userId, mode, help = true, filter = 'introduced', chosen = [], frontSide = 'term',
      } = req.body || {};
      noStore(res).json(await service().practice({
        userId, sittingId: req.params.sittingId, mode, help, filter, chosen, frontSide,
      }));
    }));
    // My words. Test mode reads the named sitting's shadow (`sittingId`).
    router.get(`${base}/words`, wrap(async (req, res) => {
      const { userId, deckId, sittingId = null } = req.query;
      noStore(res).json(await service().words({ userId, deckId, sittingId }));
    }));
    router.post(`${base}/sittings/:sittingId/items/:itemId`, wrap(async (req, res) => {
      const { userId, response = {} } = req.body || {};
      noStore(res).json(await service().respond({
        userId, sittingId: req.params.sittingId, itemId: req.params.itemId, response,
      }));
    }));
    router.get(`${base}/sittings/:sittingId`, wrap(async (req, res) => {
      noStore(res).json(await service().get({ userId: req.query.userId, sittingId: req.params.sittingId }));
    }));
    router.post(`${base}/sittings/:sittingId/close`, wrap(async (req, res) => {
      const { userId, reason = 'leave' } = req.body || {};
      noStore(res).json(await service().close({ userId, sittingId: req.params.sittingId, reason }));
    }));
  };
  router.get('/word-ladder/stage', wrap(async (_req, res) => noStore(res).json({ screen: stageScreen })));
  router.post('/word-ladder/fold', wrap(async (req, res) => {
    if (!wordLadderStudy) throw notConfigured('word-ladder');
    const { learnerId, actorId, pin = null } = req.body || {};
    noStore(res).json(await wordLadderStudy.fold({ learnerId, actorId, pin }));
  }));
  // Order does not matter: every live route has a literal second segment
  // (`open`, `sittings`, `words`, `stage`, `fold`) and every test route has `test`, so
  // the two sets are disjoint — no test path can match a live pattern.
  mount('/word-ladder/test', () => wordLadderTest, { test: true });
  mount('/word-ladder', () => wordLadderStudy, { test: false });
}

export default mountWordLadderRoutes;
