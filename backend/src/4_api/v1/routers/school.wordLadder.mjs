/**
 * `/word-ladder/…` (mastery redesign §4 API, §8 test mode). Mounted twice:
 * live, and `/word-ladder/test` over the read-only shadow service. A thin
 * shell — every rule lives in WordLadderSittingService. Responses are
 * `private, no-store`: a child's sitting must not sit in a shared cache.
 */
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
      const { userId, deckId, scenario = null } = req.body || {};
      noStore(res).json(await service().open(test ? { userId, deckId, scenario } : { userId, deckId }));
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
  // Test routes first: '/word-ladder/test/open' must not be read as a live sitting id.
  mount('/word-ladder/test', () => wordLadderTest, { test: true });
  mount('/word-ladder', () => wordLadderStudy, { test: false });
}

export default mountWordLadderRoutes;
