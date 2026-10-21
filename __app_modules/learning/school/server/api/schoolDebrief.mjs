// S/api/schoolDebrief.mjs
import express from 'express';

// The teacher capability cookie, as `createSchoolRouter` reads it (S/api/school.mjs:136):
// the cookie's path is /api/v1/school, so it reaches this sub-router too.
function capabilityProof(req) {
  const raw = String(req.get('cookie') ?? '');
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at < 0 || part.slice(0, at).trim() !== 'daylight_teacher_session') continue;
    try { return { capabilityToken: decodeURIComponent(part.slice(at + 1).trim()), stepUpToken: req.get('X-Teacher-Step-Up') ?? null }; } catch { return null; }
  }
  return null;
}
const AUDIO_FILE_RE = /^\d{4}-\d{2}-\d{2}-\d+\.(webm|ogg|m4a)$/;

const STUDY_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AUDIO = 10 * 1024 * 1024;

export function createSchoolDebriefRouter({ service, grants, teacherGate, audioStore = null, logger = console } = {}) {
  const router = express.Router();
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req, res)); } catch (err) {
      if (res.headersSent) return;
      const status = err?.name === 'GuestForbiddenError' ? 403 : (Number.isInteger(err?.status) ? err.status : 500);
      if (status >= 500) logger.error?.('school.debrief.error', { path: req.path, error: err?.message });
      res.status(status).json({ error: status >= 500 ? 'Something went wrong with the debrief.' : err.message });
    }
  };
  const granted = (req) => {
    const { learnerId, day } = req.params;
    if (!STUDY_DAY_RE.test(day)) throw Object.assign(new Error('bad day'), { status: 400 });
    const r = grants?.verify(req.get('X-School-Debrief-Grant'), { learnerId, day });
    if (!r?.ok) throw Object.assign(new Error('A current debrief launch is required'), { status: 403 });
  };
  const teacher = (req, action) => {
    const { by = null, pin = null } = req.body ?? {};
    teacherGate.assert({ userId: by, pin: pin ?? capabilityProof(req), action, context: { learnerId: req.params.learnerId } });
    return by;
  };

  // Teacher routes first so '/teacher' is never read as a learner id.
  router.get('/teacher/:learnerId/history', wrap(async (req) => {
    teacherGate.assert({ userId: req.query.by ?? null, pin: capabilityProof(req), action: 'school.debrief.read', context: { learnerId: req.params.learnerId } });
    return { days: await service.history(req.params.learnerId, { from: req.query.from ?? null, to: req.query.to ?? null }) };
  }));
  router.get('/teacher/:learnerId/audio/:file', (req, res) => {
    try {
      teacherGate.assert({ userId: req.query.by ?? null, pin: capabilityProof(req), action: 'school.debrief.read', context: { learnerId: req.params.learnerId } });
    } catch { res.status(403).end(); return; }
    if (!audioStore || !AUDIO_FILE_RE.test(req.params.file) || !/^[a-z0-9][a-z0-9_-]*$/i.test(req.params.learnerId)) { res.status(404).end(); return; }
    const found = audioStore.read(req.params.learnerId, req.params.file);
    if (!found) { res.status(404).end(); return; }
    res.type(found.mimeType).send(found.buffer);
  });
  for (const action of ['excuse', 'reject', 'rescore']) {
    router.post(`/teacher/:learnerId/day/:day/${action}`, express.json(), wrap(async (req) => {
      const by = teacher(req, `school.debrief.${action}`);
      return service[action](req.params.learnerId, req.params.day, { by, reason: req.body?.reason ?? null });
    }));
  }

  const base = '/:learnerId/day/:day';
  router.get(base, wrap(async (req) => { granted(req); return service.day(req.params.learnerId, req.params.day); }));
  router.post(`${base}/open`, wrap(async (req) => { granted(req); return service.open(req.params.learnerId, req.params.day); }));
  router.post(`${base}/take`, express.raw({ type: 'audio/*', limit: MAX_AUDIO }), wrap(async (req) => {
    granted(req);
    return service.take(req.params.learnerId, req.params.day, { buffer: Buffer.isBuffer(req.body) ? req.body : null, mimeType: req.get('Content-Type') || 'audio/webm' });
  }));
  router.post(`${base}/entry`, express.json(), wrap(async (req) => {
    granted(req);
    const { promptId, text, via = 'typed', audioRef = null } = req.body ?? {};
    return service.entry(req.params.learnerId, req.params.day, { promptId, text, via, audioRef });
  }));
  router.post(`${base}/submit`, wrap(async (req) => { granted(req); return service.submit(req.params.learnerId, req.params.day); }));
  router.post(`${base}/clarify`, express.json(), wrap(async (req) => {
    granted(req);
    const { text, via = 'typed', audioRef = null } = req.body ?? {};
    return service.clarify(req.params.learnerId, req.params.day, { text, via, audioRef });
  }));
  router.post(`${base}/answer`, express.json(), wrap(async (req) => {
    granted(req);
    return service.answer(req.params.learnerId, req.params.day, { questionId: req.body?.questionId, response: req.body?.response });
  }));
  router.post(`${base}/complete`, wrap(async (req) => { granted(req); return service.complete(req.params.learnerId, req.params.day); }));
  return router;
}
export default createSchoolDebriefRouter;
