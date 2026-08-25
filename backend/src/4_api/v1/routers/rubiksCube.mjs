import express from 'express';

/**
 * `revision` is INJECTED rather than imported from the course catalog: the API
 * layer may not reach into `3_applications` (`api-no-apps`), and a router that
 * imports a domain constant to compare against is deciding curriculum policy in
 * the transport layer. Composition owns which revision is current.
 */
export function createRubiksCubeRouter({ service, grants, revision, logger = null } = {}) {
  if (revision === undefined || revision === null) {
    throw new Error('createRubiksCubeRouter requires the current cube-course revision');
  }
  const router = express.Router();
  const authorized = (req, res) => {
    const result = grants?.verify(req.get('X-School-Cube-Grant'), { learnerId: req.params.userId, courseId: req.params.courseId });
    if (!result?.ok || result.payload.revision !== revision) { res.status(403).json({ error: 'A current assigned cube-course launch is required' }); return null; }
    return result.payload;
  };
  const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (error) { logger?.warn?.('school.rubiks-cube.request-failed', { path: req.path, error: error.message }); res.status(400).json({ error: error.message }); } };
  router.get('/preview', (_req, res) => res.json(service.preview()));
  router.get('/users/:userId/courses/:courseId', wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.open({ userId: grant.learnerId })); }));
  router.post('/users/:userId/courses/:courseId/open', express.json(), wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.open({ userId: grant.learnerId, lessonId: req.body?.lessonId ?? null })); }));
  router.post('/users/:userId/courses/:courseId/restart', express.json(), wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.restart({ userId: grant.learnerId, lessonId: req.body?.lessonId })); }));
  router.post('/users/:userId/courses/:courseId/turn', express.json(), wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.turn({ userId: grant.learnerId, lessonId: req.body?.lessonId, move: req.body?.move, expectedRevision: req.body?.expectedRevision })); }));
  router.post('/users/:userId/courses/:courseId/demo', express.json(), wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.completeDemo({ userId: grant.learnerId, lessonId: req.body?.lessonId })); }));
  router.post('/users/:userId/courses/:courseId/hint', express.json(), wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.hint({ userId: grant.learnerId, lessonId: req.body?.lessonId })); }));
  router.post('/users/:userId/courses/:courseId/answer', express.json(), wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.answer({ userId: grant.learnerId, lessonId: req.body?.lessonId, answers: req.body?.answers })); }));
  router.post('/users/:userId/courses/:courseId/physical/import', express.json({ limit: '32kb' }), wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.importPhysicalCube({ userId: grant.learnerId, faces: req.body?.faces })); }));
  router.post('/users/:userId/courses/:courseId/physical/coach', express.json(), wrap(async (req, res) => { const grant = authorized(req, res); if (grant) res.json(await service.beginPhysicalCoach({ userId: grant.learnerId, lessonId: req.body?.lessonId })); }));
  router.post('/users/:userId/courses/:courseId/physical/coach/advance', express.json(), wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.advancePhysicalCoach({ userId: grant.learnerId })); }));
  router.post('/users/:userId/courses/:courseId/physical/verify', express.json({ limit: '32kb' }), wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.verifyPhysicalCube({ userId: grant.learnerId, lessonId: req.body?.lessonId, faces: req.body?.faces })); }));
  router.post('/users/:userId/courses/:courseId/packets', express.json(), wrap(async (req, res) => { const grant = authorized(req, res); if (grant) res.json(await service.generatePacket({ userId: grant.learnerId, lessonId: req.body?.lessonId })); }));
  router.get('/users/:userId/courses/:courseId/packets/:packetId', wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.packet({ userId: grant.learnerId, packetId: req.params.packetId })); }));
  router.post('/users/:userId/courses/:courseId/packets/:packetId/verify', express.json({ limit: '32kb' }), wrap((req, res) => { const grant = authorized(req, res); if (grant) res.json(service.verifyPacket({ userId: grant.learnerId, packetId: req.params.packetId, faces: req.body?.faces })); }));
  return router;
}
export default createRubiksCubeRouter;
