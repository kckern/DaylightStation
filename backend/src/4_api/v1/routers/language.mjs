import { sendInternalError } from '#api/utils/internalError.mjs';
/**
 * /api/v1/school/sentence-ladder — thin HTTP shell over the Sentence Ladder
 * service. `/language` remains a compatibility mount during migration.
 * All policy lives in the service; this file maps errors to statuses and
 * parses query shapes. Follows school.mjs exactly.
 */
import express from 'express';

const AUDIO_CACHE = 'public, max-age=31536000, immutable';
const RUN_HEADER = 'X-School-Run-Id';

/**
 * The client mints one run id per program run and sends it on every request
 * (see `languageApi.js`). Stamping it on this side is what makes a single
 * `context.runId:"<id>"` query in the log store return one child's whole
 * session — the browser's events and the events they caused here — in order.
 *
 * It is an opaque correlation token, never an identity: it is validated for
 * shape only, and a missing or malformed one degrades to null rather than
 * failing the request. A child mid-lesson is not made to care about a header.
 */
function readRunId(req) {
  const raw = req.get(RUN_HEADER);
  if (!raw) return null;
  const value = String(raw).trim().slice(0, 64);
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : null;
}

/** Log options that put the run id on `context.*`, where the store indexes it. */
function runCtx(runId) {
  return runId ? { context: { runId } } : undefined;
}

/**
 * Capabilities describe the LEARNER'S DEVICE, so they arrive from the client
 * on every request rather than being configured server-side. The same account
 * studying from a laptop and from the touch panel gets a different ladder, and
 * that is correct.
 *
 * `textInput` is a comma-separated list of language codes, not a boolean —
 * typing Hangul and typing English are different capabilities (see ladder.mjs).
 */
function readCapabilities(query = {}) {
  const textInput = String(query.textInput ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return {
    microphone: query.microphone === 'true' || query.microphone === '1',
    textInput,
  };
}

function sendAudioResource(res, resource, { cache = AUDIO_CACHE } = {}) {
  res.writeHead(200, {
    'Content-Type': resource.contentType || 'application/octet-stream',
    'Content-Length': String(resource.size),
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
  });
  resource.open().pipe(res);
}

export function createLanguageRouter({
  languageStudyService,
  languageAudioResource,
  studyGrants = null,
  schoolErrors = {},
  coreErrors = {},
  logger = console,
}) {
  // School error CLASSES arrive via the factory. A router may not import
  // 2_domains (api-layer-guidelines.md), but it does own the mapping from a
  // domain failure to an HTTP status, so it needs the types to match on.
  // Guarded at each use: an un-injected class would make `instanceof`
  // throw a TypeError mid-request, which reads as a hang rather than a
  // wiring mistake. Composition always supplies these.
  const { GuestForbiddenError, GateClosedError } = schoolErrors;
  const { ValidationError, EntityNotFoundError } = coreErrors;
  if (!languageAudioResource) {
    throw new Error('createLanguageRouter requires languageAudioResource');
  }
  const router = express.Router();

  router.use((req, res, next) => {
    if (req.baseUrl?.endsWith('/language')) {
      logger.info?.('school.sentence-ladder.legacy-route', { method: req.method, path: req.path }, runCtx(readRunId(req)));
      res.setHeader('Deprecation', 'true');
    }
    next();
  });

  const authorized = (req, res, corpusId) => {
    if (!studyGrants) {
      res.status(503).json({ error: 'Sentence Ladder launch authority is unavailable' });
      return false;
    }
    const result = studyGrants.verify(req.get('X-School-Study-Grant'), {
      learnerId: req.params.userId,
      corpusId,
    });
    if (!result.ok) {
      logger.warn?.('school.sentence-ladder.study-grant-refused', {
        learnerId: req.params.userId, corpusId, reason: result.reason,
      }, runCtx(readRunId(req)));
      res.status(403).json({ error: 'A current learner-scoped School launch is required' });
      return false;
    }
    return true;
  };

  const wrap = (fn) => (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        // 423 Locked, with the resolved gate, so the SPA can render a remedy
        // screen instead of string-matching a 403 meant for identity.
        if (GateClosedError && err instanceof GateClosedError) {
          return res.status(423).json({
            error: err.message, gate: { level: err.level, missing: err.missing, stale: err.stale },
          });
        }
        if (GuestForbiddenError && err instanceof GuestForbiddenError) return res.status(403).json({ error: err.message });
        if (EntityNotFoundError && err instanceof EntityNotFoundError) return res.status(404).json({ error: err.message });
        if (ValidationError && err instanceof ValidationError) return res.status(400).json({ error: err.message });
        logger.error?.('school.language.router.error', { path: req.path, error: err.message }, runCtx(readRunId(req)));
        return sendInternalError(res, { error: 'internal' });
      });
  };

  router.get('/courses', wrap((req, res) => res.json(languageStudyService.listCourses())));

  // The day carries which UI cues exist so a rung builds its sound sequence
  // once, from facts, rather than probing `/cue/*` per sentence. This is
  // HTTP-layer composition: the study service knows nothing about media.
  const withCues = (day) => ({ ...day, cues: languageAudioResource.listCues?.() ?? [] });

  // A non-recording demonstration for teachers.  It is intentionally NOT a
  // `/users/:userId/*` alias: that namespace carries a study grant and every
  // mutating operation beneath it writes learner evidence.
  router.get('/preview/:corpusId/day', wrap((req, res) => {
    res.set('Cache-Control', 'private, no-store')
      .set('X-School-Preview', 'guest-non-recording')
      .json(withCues(languageStudyService.previewDay({
        corpusId: req.params.corpusId,
        capabilities: readCapabilities(req.query),
      })));
  }));

  router.get('/users/:userId/day', wrap((req, res) => {
    if (!authorized(req, res, req.query.corpus)) return;
    res.json(withCues(languageStudyService.getDay({
      userId: req.params.userId,
      corpusId: req.query.corpus,
      capabilities: readCapabilities(req.query),
      runId: readRunId(req),
    })));
  }));

  router.post('/users/:userId/log', wrap((req, res) => {
    const { corpus, seq, rung, given = null, revealed = false } = req.body || {};
    if (!authorized(req, res, corpus)) return;
    res.json(languageStudyService.logAttempt({
      userId: req.params.userId, corpusId: corpus, seq, rung, given,
      // A reveal is the learner saying "show me" instead of answering, and it
      // is written down as such. Compared to `true` rather than coerced: a
      // truthy-cast would let the string "false" — which is what a body built
      // by hand or by an older client can carry — turn an answered sentence
      // into a skip on the permanent record.
      revealed: revealed === true,
      capabilities: readCapabilities(req.query),
      runId: readRunId(req),
    }));
  }));

  router.put('/users/:userId/pacing', wrap((req, res) => {
    const { corpus, dailyLimit } = req.body || {};
    if (!authorized(req, res, corpus)) return;
    res.json(languageStudyService.setPacing({
      userId: req.params.userId, corpusId: corpus, dailyLimit, runId: readRunId(req),
    }));
  }));

  router.post('/users/:userId/roll', wrap((req, res) => {
    const { corpus } = req.body || {};
    if (!authorized(req, res, corpus)) return;
    res.json(languageStudyService.rollDay({
      userId: req.params.userId,
      corpusId: corpus,
      capabilities: readCapabilities(req.query),
      runId: readRunId(req),
    }));
  }));

  router.get('/users/:userId/history', wrap((req, res) => {
    if (!authorized(req, res, req.query.corpus)) return;
    res.json(languageStudyService.getHistory({
      userId: req.params.userId, corpusId: req.query.corpus,
    }));
  }));

  // Voice capture. Same shape as the piano recorder: a raw audio body rather
  // than multipart, since there is exactly one file and no fields.
  const rawAudio = express.raw({
    type: ['audio/webm', 'audio/ogg', 'audio/mp4', 'application/octet-stream'],
    limit: '25mb',
  });
  router.post('/users/:userId/recording', rawAudio, wrap((req, res) => {
    const { corpus, seq, ext = 'webm' } = req.query || {};
    if (!authorized(req, res, corpus)) return;
    res.json(languageStudyService.saveRecording({
      userId: req.params.userId, corpusId: corpus, seq, buffer: req.body, ext,
      capabilities: readCapabilities(req.query),
      runId: readRunId(req),
    }));
  }));

  // Media is addressed by (corpus, seq, language) and returned as an opaque
  // resource. The HTTP layer never receives a storage locator.
  router.get('/audio/:corpusId/:seq/:lang', wrap(async (req, res) => {
    const { corpusId, seq, lang } = req.params;
    const result = await languageAudioResource.getPromptAudio({
      corpusId,
      seq,
      language: lang,
    });
    if (result.kind !== 'found') {
      return res.status(404).json({ error: 'audio not found' });
    }
    sendAudioResource(res, result.resource);
  }));

  // A UI cue by ROLE, never by file name — the household picks the file in
  // school.yml. Public like prompt audio: it is a ding, not learner evidence.
  router.get('/cue/:name', wrap(async (req, res) => {
    const result = await languageAudioResource.getCueAudio({ name: req.params.name });
    if (result.kind !== 'found') {
      return res.status(404).json({ error: 'cue not found' });
    }
    sendAudioResource(res, result.resource);
  }));

  router.get('/recordings/:userId/:corpusId/:seq', wrap(async (req, res) => {
    const { userId, corpusId, seq } = req.params;
    if (!authorized(req, res, corpusId)) return;
    const result = await languageAudioResource.getRecordingAudio({ corpusId, userId, seq });
    if (result.kind !== 'found') {
      return res.status(404).json({ error: 'recording not found' });
    }
    // A learner's own voice is not content-addressed and CAN be re-recorded
    // under the same URL, so it must not be cached immutably.
    sendAudioResource(res, result.resource, { cache: 'private, max-age=60' });
  }));

  return router;
}

export default createLanguageRouter;
export const createSentenceLadderRouter = createLanguageRouter;
