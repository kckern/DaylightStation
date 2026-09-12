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

/**
 * Language codes in words, for the ONE place a language name is needed: the
 * Whisper bias prompt on a spoken answer.
 *
 * AN ALLOWLIST, NOT A PASS-THROUGH, and that is the whole reason it exists. A
 * Whisper prompt biases recognition toward the words in it, so any client
 * string that reaches the prompt is a way to make the model hear a sentence
 * nobody said — including the expected answer. A code with no entry here
 * resolves to `undefined` and the profile falls back to its own default, so
 * the worst a hostile query string can do is get English.
 *
 * The frontend has the same two-line map for its own copy
 * (`SentenceLadder/languageNames.js`); duplicating two words is cheaper than a
 * shared module that would tempt someone into making either side dynamic.
 */
const SPOKEN_LANGUAGE_NAMES = Object.freeze({ EN: 'English', KR: 'Korean' });

/**
 * The register the corpus is written in. A CONSTANT, never a request field:
 * the profile takes a key from a closed set, and letting a client choose the
 * key is one step from letting it choose the text.
 */
const SPOKEN_REGISTER = 'everyday';

export function createLanguageRouter({
  languageStudyService,
  languageAudioResource,
  // Optional. Absent means the household has no AI gateway, which is a normal
  // configuration and not a fault: the day says so, the client draws no mic,
  // and typing is still the way through. See the transcribe route below.
  languageTranscription = null,
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
  //
  // `voiceAnswer` is the same kind of fact one layer up: whether this
  // deployment can turn speech into text at all. A client that had to find out
  // by pressing a mic and getting a 503 would be drawing a control that cannot
  // work — the dead-button failure this screen keeps designing around — so the
  // answer travels with the day and the control is simply never drawn.
  const withCues = (day) => ({
    ...day,
    cues: languageAudioResource.listCues?.() ?? [],
    voiceAnswer: Boolean(languageTranscription),
  });

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
    const { corpus, seq, rung, given = null, revealed = false, method = null } = req.body || {};
    if (!authorized(req, res, corpus)) return;
    res.json(languageStudyService.logAttempt({
      userId: req.params.userId, corpusId: corpus, seq, rung, given,
      // HOW the answer was produced — typed, or spoken and transcribed. Passed
      // straight through and validated by the service: an older client sends
      // nothing and the field stays absent rather than being inferred, because
      // a guessed method in an append-only log outlives whoever guessed it.
      method,
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

  /**
   * A SPOKEN ANSWER TO A TYPING RUNG. Audio in, a transcript back — and
   * nothing is written down here. The learner reads the transcript in their
   * own field, edits it, and submits it through `/log` like any other answer,
   * so a mistranscription is something they can see and fix rather than a
   * mistake they are marked down for without ever being told why.
   *
   * ⚠ THE ONE RULE. Nothing derived from the expected answer may reach the
   * transcription call. A Whisper prompt biases recognition: give it the
   * English sentence and the model hears that sentence whatever the child
   * said, and the rung then measures nothing while looking perfect.
   *
   * The route is built so that rule cannot be broken by accident rather than
   * merely being observed: it never touches the corpus. `authorized` checks a
   * grant's SCOPE against the corpus id and loads nothing, so no expected text
   * is ever in scope on this path. `seq` is taken for the log line only. The
   * context handed to the profile is exactly two fields, both resolved from
   * closed sets — a language name from `SPOKEN_LANGUAGE_NAMES`, a register
   * constant — so a query string has nothing to widen. The profile ignores
   * everything else anyway; this is the belt to its braces.
   *
   * NOT `POST /sentence-ladder/transcribe` as the plan wrote it: every write
   * on this rung is a learner-scoped route under `/users/:userId/`, and the
   * study-grant guard reads `req.params.userId`. A top-level path could not
   * wear the same guard, which is the one property the plan actually asked for.
   */
  router.post('/users/:userId/transcribe', rawAudio, wrap(async (req, res) => {
    const { corpus, seq = null, lang = null } = req.query || {};
    if (!authorized(req, res, corpus)) return;
    const runId = readRunId(req);
    if (!languageTranscription) {
      // A normal configuration, not a fault: this household has no AI gateway.
      // The day already said `voiceAnswer: false`, so reaching here means a
      // stale client — answer plainly and let it fall back to typing.
      logger.info?.('school.sentence-ladder.transcribe-unavailable', {
        learnerId: req.params.userId, corpus,
      }, runCtx(runId));
      return res.status(503).json({ error: 'Spoken answers are unavailable on this server' });
    }
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'recording is empty' });
    }

    const startedAt = Date.now();
    const result = await languageTranscription.transcribe({
      audioBuffer: buffer,
      mimeType: req.get('Content-Type') || 'audio/webm',
      sessionId: runId,
      context: {
        spokenLanguage: SPOKEN_LANGUAGE_NAMES[String(lang || '').toUpperCase()],
        register: SPOKEN_REGISTER,
      },
    });

    const text = String(result?.transcriptClean ?? '').trim();
    const empty = !text || Boolean(languageTranscription.isEmpty?.(text));
    // Lengths, never contents. The transcript is a child's voice written down;
    // shipping it to the log store would put their speech in a searchable
    // index that outlives the audio it came from.
    logger.info?.('school.sentence-ladder.transcribed', {
      learnerId: req.params.userId,
      corpus,
      seq: seq == null ? null : Number(seq),
      bytes: buffer.length,
      transcriptLength: text.length,
      empty,
      ms: Date.now() - startedAt,
    }, runCtx(runId));

    // An empty transcript is an outcome, not an error: the mic may have been
    // covered, or the child may have said nothing. The field is left alone and
    // the screen says so — see TypedRung.
    return res.json({ transcript: empty ? '' : text, empty });
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
