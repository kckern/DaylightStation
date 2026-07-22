/**
 * /api/v1/school/language — thin HTTP shell over LanguageStudyService.
 * All policy lives in the service; this file maps errors to statuses and
 * parses query shapes. Follows school.mjs exactly.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { GuestForbiddenError } from '#domains/school/errors.mjs';
import { ValidationError, EntityNotFoundError } from '#domains/core/errors/index.mjs';

const AUDIO_CACHE = 'public, max-age=31536000, immutable';
const EXT_CONTENT_TYPE = {
  mp3: 'audio/mpeg', webm: 'audio/webm', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
};

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

function sendAudioFile(res, filePath, { cache = AUDIO_CACHE } = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'audio not found' });
    return;
  }
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': EXT_CONTENT_TYPE[ext] || 'application/octet-stream',
    'Content-Length': String(stat.size),
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
  });
  fs.createReadStream(filePath).pipe(res);
}

export function createLanguageRouter({ languageStudyService, logger = console }) {
  const router = express.Router();

  const wrap = (fn) => (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((err) => {
        if (err instanceof GuestForbiddenError) return res.status(403).json({ error: err.message });
        if (err instanceof EntityNotFoundError) return res.status(404).json({ error: err.message });
        if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
        logger.error?.('school.language.router.error', { path: req.path, error: err.message });
        return res.status(500).json({ error: 'internal' });
      });
  };

  router.get('/courses', wrap((req, res) => res.json(languageStudyService.listCourses())));

  router.get('/users/:userId/day', wrap((req, res) => {
    res.json(languageStudyService.getDay({
      userId: req.params.userId,
      corpusId: req.query.corpus,
      capabilities: readCapabilities(req.query),
    }));
  }));

  router.post('/users/:userId/log', wrap((req, res) => {
    const { corpus, seq, rung, given = null } = req.body || {};
    res.json(languageStudyService.logAttempt({
      userId: req.params.userId, corpusId: corpus, seq, rung, given,
    }));
  }));

  router.put('/users/:userId/pacing', wrap((req, res) => {
    const { corpus, dailyLimit } = req.body || {};
    res.json(languageStudyService.setPacing({
      userId: req.params.userId, corpusId: corpus, dailyLimit,
    }));
  }));

  router.post('/users/:userId/roll', wrap((req, res) => {
    const { corpus } = req.body || {};
    res.json(languageStudyService.rollDay({
      userId: req.params.userId,
      corpusId: corpus,
      capabilities: readCapabilities(req.query),
    }));
  }));

  router.get('/users/:userId/history', wrap((req, res) => {
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
    res.json(languageStudyService.saveRecording({
      userId: req.params.userId, corpusId: corpus, seq, buffer: req.body, ext,
    }));
  }));

  // Media is addressed by (corpus, seq, language) slug and resolved to a real
  // path server-side — a caller never supplies a filename, so nothing can
  // traverse out of the media tree.
  router.get('/audio/:corpusId/:seq/:lang', wrap((req, res) => {
    const { corpusId, seq, lang } = req.params;
    sendAudioFile(res, languageStudyService.resolveAudioPath(corpusId, seq, lang));
  }));

  router.get('/recordings/:userId/:corpusId/:seq', wrap((req, res) => {
    const { userId, corpusId, seq } = req.params;
    // A learner's own voice is not content-addressed and CAN be re-recorded
    // under the same URL, so it must not be cached immutably.
    for (const ext of ['webm', 'mp3', 'ogg', 'm4a', 'wav']) {
      const candidate = languageStudyService.resolveRecordingPath(corpusId, userId, seq, ext);
      if (candidate && fs.existsSync(candidate)) {
        sendAudioFile(res, candidate, { cache: 'private, max-age=60' });
        return;
      }
    }
    res.status(404).json({ error: 'recording not found' });
  }));

  return router;
}

export default createLanguageRouter;
