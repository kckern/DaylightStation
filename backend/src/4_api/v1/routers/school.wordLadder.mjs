/**
 * `/word-ladder/…` — the word ladder for any word package (word-ladder design
 * "Recording" and "Daily session"). Session ids are opaque here (they carry
 * their package: `<package>.<id>`). A thin shell: authorization (the learner's actual
 * word-ladder assignment, the open session, today's plan) and every grading
 * rule live in `WordLadderStudyService`. Responses are `private, no-store`:
 * a child's plan must not sit in a shared browser cache on a household screen.
 */
import express from 'express';

export function mountWordLadderRoutes({ router, wrap, notConfigured, wordLadderStudy = null, sendFileResource }) {
  const service = () => {
    if (!wordLadderStudy) throw notConfigured('word-ladder study');
    return wordLadderStudy;
  };
  const noStore = (res) => res.set('Cache-Control', 'private, no-store');
  const rawAudio = express.raw({
    type: ['audio/webm', 'audio/ogg', 'audio/mp4', 'application/octet-stream'],
    limit: '10mb',
  });

  router.post('/word-ladder/open', wrap(async (req, res) => {
    const { userId, deckId } = req.body || {};
    noStore(res).json(await service().open({ userId, deckId }));
  }));
  router.post('/word-ladder/fold', wrap(async (req, res) => {
    const { learnerId, actorId, pin = null } = req.body || {};
    noStore(res).json(await service().fold({ learnerId, actorId, pin }));
  }));
  router.get('/word-ladder/:sessionId/plan', wrap(async (req, res) => {
    noStore(res).json(await service().plan({ userId: req.query.userId, sessionId: req.params.sessionId }));
  }));
  router.post('/word-ladder/:sessionId/checks/:wordId', wrap(async (req, res) => {
    const { userId, choice } = req.body || {};
    noStore(res).json(await service().answerCheck({ userId, sessionId: req.params.sessionId, wordId: req.params.wordId, choice }));
  }));
  router.post('/word-ladder/:sessionId/cards/:wordId/recording', rawAudio, wrap(async (req, res) => {
    noStore(res).json(await service().saveRecording({
      userId: req.query.userId, sessionId: req.params.sessionId, wordId: req.params.wordId,
      buffer: Buffer.isBuffer(req.body) ? req.body : null, ext: req.query.ext ?? 'webm',
    }));
  }));
  router.get('/word-ladder/:sessionId/cards/:wordId/recording/latest', wrap(async (req, res) => {
    const found = await service().latestRecording({ userId: req.query.userId, sessionId: req.params.sessionId, wordId: req.params.wordId });
    noStore(res).type(found.contentType);
    return sendFileResource(req, res, found.resource);
  }));
  router.post('/word-ladder/:sessionId/cards/:wordId/mark', wrap(async (req, res) => {
    const { userId, mark, recording = null } = req.body || {};
    noStore(res).json(await service().markCard({ userId, sessionId: req.params.sessionId, wordId: req.params.wordId, mark, recording }));
  }));
  router.post('/word-ladder/:sessionId/review/:wordId', wrap(async (req, res) => {
    const { userId } = req.body || {};
    noStore(res).json(await service().viewReviewCard({ userId, sessionId: req.params.sessionId, wordId: req.params.wordId }));
  }));
}

export default mountWordLadderRoutes;
