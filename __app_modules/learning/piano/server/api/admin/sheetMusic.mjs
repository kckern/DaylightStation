/**
 * Admin Sheet Music HTTP translation, mounted at `/api/v1/admin/sheet-music`
 * (behind the `admin/*` permission gate).
 *
 * The score is named by `?id=<content id>` (URL-encoded `files:docs/sheet-music/...`).
 *
 *   GET  /                    → { scores, folders }   library rows + folders an upload may name
 *   POST /upload              → 201 { id, title, composer, filename }  multipart `file`, `folder`, optional `filename`
 *   GET  /learn               → the Learn file with draftRevision, currentSha256, stale
 *   PUT  /learn               → body { action: 'draft'|'approve'|'revert', ... }
 *   GET  /learn/draft-impact  → { draftRevision, impact }
 *   POST /impact              → { impact }  body { segments } (revert impact against the generated plan)
 *   POST /poster              → 201 { id, poster, url, bytes }  body: the SVG text (image/svg+xml only)
 *
 * Coded refusals from the injected SheetMusicAdminService become
 * `{ error: code }` (plus `errors` for invalid-segments, `draftRevision` for
 * draft-changed) with the status in STATUS_BY_CODE, logged at warn as
 * `admin.sheetmusic.request-rejected` { route, code, id }. Anything else is logged
 * as `admin.sheetmusic.request-failed` { route, code } and goes to the
 * string-shape error handler, which answers 500 without the message.
 *
 * Malformed requests are refused before the service: an unparseable or
 * truncated multipart body, a poster body that is not image/svg+xml (400) or is
 * over MAX_POSTER_BODY_BYTES (413 too-large), `/impact` without a `segments` array, and more than
 * MAX_SEGMENTS segments in a draft or impact request.
 */
import express from 'express';
import multer from 'multer';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { MAX_POSTER_BYTES } from '../../../portable/music/svgSafety.mjs';

/** Multer's cap; the service applies the per-format limits (16 MB .mxl, 32 MB .musicxml). */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** The poster body cap: the svgSafety limit, so an oversized body never reaches the service. */
export const MAX_POSTER_BODY_BYTES = MAX_POSTER_BYTES;

/** Most segments a draft or impact request may carry; a score has far fewer passages. */
export const MAX_SEGMENTS = 500;

const MAX_LOGGED_ID = 200;

const STATUS_BY_CODE = {
  'invalid-request': 400,
  NOT_LIBRARY_SCORE: 400,
  'bad-folder': 400,
  'bad-filename': 400,
  SCORE_NOT_FOUND: 404,
  'no-draft': 409,
  'draft-changed': 409,
  'basename-exists': 409,
  'slug-collides': 409,
  'has-scan': 409,
  'poster-exists': 409,
  SCORE_TOO_LARGE: 413,
  'too-large': 413,
  'bad-extension': 415,
  'invalid-segments': 422,
  'bad-mxl': 422,
  'not-xml': 422,
  timewise: 422,
  'not-partwise': 422,
  'no-notes': 422,
  'slug-too-long': 422,
  SCORE_UNREADABLE: 422,
  // svgSafety refusals
  'not-svg': 422,
  'bad-char': 422,
  doctype: 422,
  'processing-instruction': 422,
  namespace: 422,
  script: 422,
  'foreign-object': 422,
  element: 422,
  'event-handler': 422,
  attribute: 422,
  'external-href': 422,
  entity: 422,
};

const ACTIONS = new Set(['draft', 'approve', 'revert']);

const SERVICE_METHODS = ['library', 'uploadFolders', 'upload', 'getLearn', 'saveDraft', 'approve', 'revert', 'draftImpact', 'impact', 'savePoster'];

function refusal(code) {
  return Object.assign(new Error(`Request refused: ${code}`), { code });
}

export function createAdminSheetMusicRouter({ service, logger = console } = {}) {
  if (!service || SERVICE_METHODS.some((name) => typeof service[name] !== 'function')) {
    throw new Error('createAdminSheetMusicRouter requires service');
  }
  const router = express.Router();
  const posterText = express.text({ type: 'image/svg+xml', limit: MAX_POSTER_BODY_BYTES });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  /** Answers a coded refusal; false when the error is not one (the caller rethrows). */
  const loggedId = (req) => (typeof req.query.id === 'string' ? req.query.id.slice(0, MAX_LOGGED_ID) : null);

  const sendRefusal = (req, res, route, error) => {
    const code = typeof error?.code === 'string' ? error.code : null;
    const status = code ? STATUS_BY_CODE[code] : undefined;
    if (!status) return false;
    const body = { error: code };
    if (code === 'invalid-segments' && Array.isArray(error.errors)) body.errors = error.errors;
    if (code === 'draft-changed' && error.draftRevision !== undefined) body.draftRevision = error.draftRevision;
    logger.warn?.('admin.sheetmusic.request-rejected', { route, code, id: loggedId(req) });
    res.status(status).json(body);
    return true;
  };

  /** Runs `fn`, mapping coded refusals; other errors reach the error handler. */
  const handle = (route, fn) => asyncHandler(async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (sendRefusal(req, res, route, error)) return;
      logger.error?.('admin.sheetmusic.request-failed', { route, code: error?.code ?? null });
      throw error;
    }
  });

  const scoreId = (req) => {
    const id = req.query.id;
    if (typeof id !== 'string' || id === '') throw refusal('invalid-request');
    return id;
  };

  /** A segments list within the cap; anything else is refused. */
  const checkSegments = (segments, { required }) => {
    if (segments === undefined && !required) return;
    if (!Array.isArray(segments) || segments.length > MAX_SEGMENTS) throw refusal('invalid-request');
  };

  /**
   * multer as a promise. Every parser failure is the client's request: an
   * oversized file is SCORE_TOO_LARGE, anything else (MulterError, busboy's
   * "Boundary not found" / "Unexpected end of form", an aborted body) is
   * invalid-request.
   */
  const receiveFile = (req, res) => new Promise((resolve, reject) => {
    upload.single('file')(req, res, (error) => {
      if (!error) return resolve();
      reject(refusal(error?.code === 'LIMIT_FILE_SIZE' ? 'SCORE_TOO_LARGE' : 'invalid-request'));
    });
  });

  /** The SVG body as text; an oversized body is too-large, any other parser failure invalid-request. */
  const receivePoster = (req, res) => new Promise((resolve, reject) => {
    posterText(req, res, (error) => {
      if (!error) return resolve();
      reject(refusal(error?.type === 'entity.too.large' ? 'too-large' : 'invalid-request'));
    });
  });

  router.get('/', handle('GET /', async (req, res) => {
    const [scores, folders] = await Promise.all([service.library(), service.uploadFolders()]);
    res.json({ scores, folders });
  }));

  router.post('/upload', handle('POST /upload', async (req, res) => {
    await receiveFile(req, res);
    if (!req.file?.buffer) throw refusal('invalid-request');
    const { folder, filename } = req.body || {};
    const result = await service.upload({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      folder: typeof folder === 'string' ? folder : undefined,
      filename: typeof filename === 'string' && filename !== '' ? filename : undefined,
    });
    res.status(201).json(result);
  }));

  router.get('/learn', handle('GET /learn', async (req, res) => {
    res.json(await service.getLearn(scoreId(req)));
  }));

  router.put('/learn', handle('PUT /learn', async (req, res) => {
    const id = scoreId(req);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const { action } = body;
    if (typeof action !== 'string' || !ACTIONS.has(action)) throw refusal('invalid-request');
    if (action === 'draft') {
      const { segments, proposal, measureCount } = body;
      checkSegments(segments, { required: false });
      return res.json(await service.saveDraft(id, { segments, proposal, measureCount }));
    }
    if (action === 'approve') {
      const { measureCount, expectedDraftRevision } = body;
      return res.json(await service.approve(id, { measureCount, expectedDraftRevision }));
    }
    return res.json(await service.revert(id));
  }));

  router.get('/learn/draft-impact', handle('GET /learn/draft-impact', async (req, res) => {
    res.json(await service.draftImpact(scoreId(req)));
  }));

  router.post('/impact', handle('POST /impact', async (req, res) => {
    const id = scoreId(req);
    const segments = req.body?.segments;
    checkSegments(segments, { required: true });
    res.json({ impact: await service.impact(id, segments) });
  }));

  router.post('/poster', handle('POST /poster', async (req, res) => {
    const id = scoreId(req);
    await receivePoster(req, res);
    if (typeof req.body !== 'string' || req.body === '') throw refusal('invalid-request');
    res.status(201).json(await service.savePoster(id, req.body));
  }));

  router.use(errorHandlerMiddleware({ shape: 'string' }));
  return router;
}

export default createAdminSheetMusicRouter;
