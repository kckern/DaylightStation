import { sendInternalError } from '#api/utils/internalError.mjs';
import express from 'express';
import { safeSegment } from './lib/emulatorPaths.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const MODERATE_CACHE = 'public, max-age=3600';

/**
 * Parse a single-range `Range: bytes=start-end` header against a known size.
 * Returns { start, end } (inclusive) or null if absent/unsatisfiable.
 */
function parseRange(header, size) {
  if (!header || typeof size !== 'number') return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    // suffix range: last N bytes
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null) {
    end = size - 1;
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

/**
 * Send an opaque binary resource ({ size, mimeType, open }) honoring an
 * optional already-resolved range. Sets long immutable cache for static media.
 */
function sendBinary(res, resource, { range, cache = true } = {}) {
  const headers = {
    'Content-Type': resource.mimeType || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
  };
  // `cache: true` → immutable (ROMs are content-fixed by id). A string sets an
  // explicit Cache-Control — covers/bezels use a moderate TTL since art can be
  // swapped under the same URL (an immutable cover never updates in-browser).
  if (typeof cache === 'string') headers['Cache-Control'] = cache;
  else if (cache) headers['Cache-Control'] = IMMUTABLE_CACHE;

  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${resource.size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
    res.writeHead(206, headers);
  } else {
    if (typeof resource.size === 'number') headers['Content-Length'] = String(resource.size);
    res.writeHead(200, headers);
  }

  resource.open(range).pipe(res);
}

/**
 * Emulator router. Addresses all media by safe (:system, :gameId) slugs and
 * resolves the real on-disk filenames behind application operations. The API
 * receives opaque resources and never sees storage paths or filesystem APIs.
 *
 * @param {object} deps
 * @param {object}   [deps.logger]
 * @param {object} deps.emulatorResources  Endpoint-shaped application operations.
 * @param {object} deps.emulatorLibrary    Semantic public-library service.
 * @param {function} [deps.publishBtPair]  ({ requestId, durationMs }) => void — broadcasts the bt.pair.request bus topic the garage bridge listens for. Default: warn no-op.
 * @param {function} [deps.makeRequestId]  () => string — injectable for deterministic tests. Default: incrementing counter.
 * @returns {express.Router}
 */
export function createEmulatorRouter({
  logger = NOOP_LOGGER,
  emulatorResources,
  emulatorLibrary,
  publishBtPair = () => { logger.warn('emulator.bt_pair.no_publisher', {}); },
  makeRequestId = (() => { let n = 0; return () => `btpair-${++n}`; })(),
}) {
  if (!emulatorLibrary?.getLibrary) throw new Error('createEmulatorRouter: library application service required');
  const router = express.Router();
  router.use(express.json());

  // ---- POST /bt/pair -------------------------------------------------------
  // Puts the garage box into controller-pairing mode without SSH: broadcasts a
  // bt.pair.request bus topic the fitness bridge listens for. The bridge runs a
  // time-boxed BlueZ pairing window and streams bt.pair.progress back. We don't
  // wait on the window — respond 202 with the requestId for progress correlation.
  router.post('/bt/pair', (req, res) => {
    const requestId = makeRequestId();
    const durationMs = Number(req.body?.durationMs) || 30000;
    try {
      publishBtPair({ requestId, durationMs });
    } catch (err) {
      // Rethrow: Express 5 forwards it to errorHandlerMiddleware, which owns
      // status mapping. A local 500 bypasses it.
      logger.error('emulator.bt_pair.publish_error', { requestId, error: err.message });
      throw err;
    }
    logger.info('emulator.bt_pair.requested', { requestId, durationMs });
    res.status(202).json({ requestId });
  });

  // ---- GET /engine/* -------------------------------------------------------
  // Serves the vendored EmulatorJS bundle (loader.js, emulator.min.js/css,
  // cores/*, compression/*). This is what EJS_pathtodata points at. Each path
  // segment is validated (dot-allowed for filenames) so the wildcard can never
  // escape the engine dir.
  router.get('/engine/*splat', (req, res) => {
    if (typeof emulatorResources?.getEngineResource !== 'function') {
      return res.status(404).json({ error: 'not found' });
    }
    const wildcard = splatPath(req);
    let assetId;
    try {
      const segments = wildcard.split('/').filter((s) => s !== '');
      if (segments.length === 0) throw new Error('unsafe path segment');
      for (const seg of segments) safeSegment(seg, { dot: true });
      assetId = segments.join('/');
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    try {
      const resource = emulatorResources.getEngineResource(assetId);
      const headers = {
        'Content-Type': resource.mimeType || 'application/octet-stream',
        'Cache-Control': MODERATE_CACHE,
      };
      if (typeof resource.size === 'number') headers['Content-Length'] = String(resource.size);
      res.writeHead(200, headers);
      resource.open().pipe(res);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'not found' });
      }
      logger.error('emulator.engine.error', { assetId, error: err.message });
      throw err;
    }
  });

  // ---- GET /library --------------------------------------------------------
  router.get('/library', (req, res) => {
    try {
      const user = req.query.user ? safeSegment(String(req.query.user)) : null;
      const library = emulatorLibrary.getLibrary(user);
      const games = library.games.map((game) => {
          return {
            ...game,
            romUrl: `/api/v1/emulator/rom/${game.system}/${game.id}`,
            coverUrl: `/api/v1/emulator/art/${game.system}/${game.id}/cover`,
            bezelUrl: `/api/v1/emulator/art/${game.system}/${game.id}/bezel`,
          };
        });
      res.json({ ...library, games });
    } catch (err) {
      if (/unsafe path segment/.test(err.message)) return res.status(400).json({ error: 'bad request' });
      logger.error('emulator.library.error', { error: err.message });
      sendInternalError(res, { error: 'internal error' });
    }
  });

  // ---- GET /rom/:system/:gameId -------------------------------------------
  router.get('/rom/:system/:gameId', (req, res) => {
    let system, gameId;
    try {
      system = safeSegment(req.params.system);
      gameId = safeSegment(req.params.gameId);
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    try {
      const resource = emulatorResources.getRomResource({ system, gameId });
      const range = parseRange(req.headers.range, resource.size);
      sendBinary(res, resource, { range, cache: true });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
      logger.error('emulator.rom.error', { system, gameId, error: err.message });
      sendInternalError(res, { error: 'internal error' });
    }
  });

  // ---- GET /art/:system/:gameId/:kind -------------------------------------
  router.get('/art/:system/:gameId/:kind', (req, res) => {
    let system, gameId, kind;
    try {
      system = safeSegment(req.params.system);
      gameId = safeSegment(req.params.gameId);
      kind = safeSegment(req.params.kind);
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    if (kind !== 'cover' && kind !== 'bezel') return res.status(400).json({ error: 'bad kind' });
    try {
      const resource = emulatorResources.getArtResource({ system, gameId, kind });
      // Moderate (not immutable): art may be swapped under the same URL.
      sendBinary(res, resource, { cache: MODERATE_CACHE });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
      logger.error('emulator.art.error', { system, gameId, kind, error: err.message });
      sendInternalError(res, { error: 'internal error' });
    }
  });

  // ---- save / state read/write helpers ------------------------------------
  const rawBody = express.raw({ type: '*/*', limit: '8mb' });

  function readUserBlob(req, res, getResource) {
    let system, gameId, slot, user;
    try {
      system = safeSegment(req.params.system);
      gameId = safeSegment(req.params.gameId);
      if (req.params.slot !== undefined) slot = safeSegment(req.params.slot, { dot: true });
      user = safeSegment(String(req.query.user ?? ''));
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    try {
      const resource = getResource({ system, gameId, slot, user });
      sendBinary(res, resource, { cache: false });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(204).end();
      logger.error('emulator.blob.read_error', { system, gameId, slot, error: err.message });
      sendInternalError(res, { error: 'internal error' });
    }
  }

  async function writeUserBlob(req, res, storeArtifact) {
    let system, gameId, slot, user;
    try {
      system = safeSegment(req.params.system);
      gameId = safeSegment(req.params.gameId);
      if (req.params.slot !== undefined) slot = safeSegment(req.params.slot, { dot: true });
      user = safeSegment(String(req.query.user ?? ''));
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).json({ error: 'empty body' });
    }
    try {
      const artifact = Object.freeze({
        size: body.length,
        async *chunks() { yield body; },
      });
      await storeArtifact({ system, gameId, slot, user }, artifact);
      res.json({ ok: true, bytes: artifact.size });
    } catch (err) {
      logger.error('emulator.blob.write_error', { system, gameId, slot, error: err.message });
      sendInternalError(res, { error: 'internal error' });
    }
  }

  async function deleteUserBlob(req, res, deleteResource) {
    let system, gameId, slot, user;
    try {
      system = safeSegment(req.params.system);
      gameId = safeSegment(req.params.gameId);
      if (req.params.slot !== undefined) slot = safeSegment(req.params.slot, { dot: true });
      user = safeSegment(String(req.query.user ?? ''));
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    if (typeof deleteResource !== 'function') {
      return sendInternalError(res, { error: 'delete unsupported' });
    }
    try {
      await deleteResource({ system, gameId, slot, user });
      res.json({ ok: true });
    } catch (err) {
      logger.error('emulator.blob.delete_error', { system, gameId, slot, error: err.message });
      sendInternalError(res, { error: 'internal error' });
    }
  }

  // ---- saves ---------------------------------------------------------------
  router.get('/save/:system/:gameId', (req, res) =>
    readUserBlob(req, res, (key) => emulatorResources.getSaveResource(key))
  );
  router.put('/save/:system/:gameId', rawBody, (req, res) =>
    writeUserBlob(req, res, (key, artifact) => emulatorResources.storeSaveArtifact(key, artifact))
  );
  router.delete('/save/:system/:gameId', (req, res) =>
    deleteUserBlob(req, res, emulatorResources?.deleteSave?.bind(emulatorResources))
  );

  // ---- states --------------------------------------------------------------
  router.get('/state/:system/:gameId/:slot', (req, res) =>
    readUserBlob(req, res, (key) => emulatorResources.getStateResource(key))
  );
  router.put('/state/:system/:gameId/:slot', rawBody, (req, res) =>
    writeUserBlob(req, res, (key, artifact) => emulatorResources.storeStateArtifact(key, artifact))
  );
  router.delete('/state/:system/:gameId/:slot', (req, res) =>
    deleteUserBlob(req, res, emulatorResources?.deleteState?.bind(emulatorResources))
  );

  // ---- GET /saves/:system/:gameId -----------------------------------------
  // Users who have a save for this game (drives the "Continue as…" row).
  // Returns [] for none-save games without touching the FS.
  router.get('/saves/:system/:gameId', (req, res) => {
    let system, gameId;
    try {
      system = safeSegment(req.params.system);
      gameId = safeSegment(req.params.gameId);
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    if (typeof emulatorResources?.listSaveUsers !== 'function') return res.json({ users: [] });
    try {
      res.json({ users: emulatorResources.listSaveUsers({ system, gameId }) });
    } catch (err) {
      logger.error('emulator.saves.error', { system, gameId, error: err.message });
      sendInternalError(res, { error: 'internal error' });
    }
  });

  return router;
}
