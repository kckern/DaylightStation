import express from 'express';
import { safeSegment } from './lib/emulatorPaths.mjs';
import { buildCatalog, resolveGameRules } from '../../../3_applications/emulator/EmulatorCatalog.mjs';

const NOOP_LOGGER = { warn() {}, info() {}, debug() {}, error() {} };
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const MODERATE_CACHE = 'public, max-age=3600';

const ENGINE_CONTENT_TYPES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
};

function engineContentTypeFor(relPath) {
  const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
  return ENGINE_CONTENT_TYPES[ext] || 'application/octet-stream';
}

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
 * Send a binary result ({ buffer|stream, size, contentType }) honoring an
 * optional already-resolved range. Sets long immutable cache for static media.
 */
function sendBinary(res, result, { range, cache = true } = {}) {
  const headers = {
    'Content-Type': result.contentType || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
  };
  // `cache: true` → immutable (ROMs are content-fixed by id). A string sets an
  // explicit Cache-Control — covers/bezels use a moderate TTL since art can be
  // swapped under the same URL (an immutable cover never updates in-browser).
  if (typeof cache === 'string') headers['Cache-Control'] = cache;
  else if (cache) headers['Cache-Control'] = IMMUTABLE_CACHE;

  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${result.size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
    res.writeHead(206, headers);
  } else {
    if (typeof result.size === 'number') headers['Content-Length'] = String(result.size);
    res.writeHead(200, headers);
  }

  if (result.stream) {
    result.stream.pipe(res);
  } else {
    res.end(result.buffer);
  }
}

/**
 * Emulator router. Addresses all media by safe (:system, :gameId) slugs and
 * resolves the real on-disk (messy) filenames server-side via injected
 * resolvers. All file I/O is injected so the router is unit-testable.
 *
 * @param {object} deps
 * @param {object}   [deps.logger]
 * @param {function} deps.loadConfig       () => normalized cfg.
 * @param {function} deps.readBinary       (absPath, { range }?) => { buffer|stream, size, contentType }; throws .code==='ENOENT'.
 * @param {function} deps.writeBinary      (absPath, buffer) => Promise<void> (atomic).
 * @param {function} [deps.readEngineFile] (relPath) => { buffer|stream, size, contentType }; throws .code==='ENOENT'. Serves the vendored EmulatorJS bundle.
 * @param {function} deps.resolveRomPath   (cfg, system, gameId) => absPath.
 * @param {function} deps.resolveArtPath   (cfg, system, gameId, kind) => absPath.
 * @param {function} deps.resolveSavePath  (system, gameId, user) => absPath.
 * @param {function} deps.resolveStatePath (system, gameId, slot, user) => absPath.
 * @param {function} [deps.publishBtPair]  ({ requestId, durationMs }) => void — broadcasts the bt.pair.request bus topic the garage bridge listens for. Default: warn no-op.
 * @param {function} [deps.makeRequestId]  () => string — injectable for deterministic tests. Default: incrementing counter.
 * @returns {express.Router}
 */
export function createEmulatorRouter({
  logger = NOOP_LOGGER,
  loadConfig,
  readBinary,
  writeBinary,
  deleteBinary,
  readEngineFile,
  resolveRomPath,
  resolveArtPath,
  resolveSavePath,
  resolveStatePath,
  listSaveUsers,
  publishBtPair = () => { logger.warn('emulator.bt_pair.no_publisher', {}); },
  makeRequestId = (() => { let n = 0; return () => `btpair-${++n}`; })(),
}) {
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
      logger.error('emulator.bt_pair.publish_error', { requestId, error: err.message });
      return res.status(500).json({ error: 'internal error' });
    }
    logger.info('emulator.bt_pair.requested', { requestId, durationMs });
    res.status(202).json({ requestId });
  });

  // ---- GET /engine/* -------------------------------------------------------
  // Serves the vendored EmulatorJS bundle (loader.js, emulator.min.js/css,
  // cores/*, compression/*). This is what EJS_pathtodata points at. Each path
  // segment is validated (dot-allowed for filenames) so the wildcard can never
  // escape the engine dir.
  router.get('/engine/*', (req, res) => {
    if (typeof readEngineFile !== 'function') {
      return res.status(404).json({ error: 'not found' });
    }
    const wildcard = req.params[0] || '';
    let relPath;
    try {
      const segments = wildcard.split('/').filter((s) => s !== '');
      if (segments.length === 0) throw new Error('unsafe path segment');
      for (const seg of segments) safeSegment(seg, { dot: true });
      relPath = segments.join('/');
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    try {
      const result = readEngineFile(relPath);
      const headers = {
        // Engine files are typed by extension (the generic readBinary type would
        // mislabel JS as octet-stream and break script execution / WASM streaming).
        'Content-Type': engineContentTypeFor(relPath),
        'Cache-Control': MODERATE_CACHE,
      };
      if (typeof result.size === 'number') headers['Content-Length'] = String(result.size);
      res.writeHead(200, headers);
      if (result.stream) result.stream.pipe(res);
      else res.end(result.buffer);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // EmulatorJS requests localization/<locale>.json (e.g. en-US.json from the
        // browser locale); our self-hosted bundle only ships en.json. Fall back so
        // a missing locale doesn't 404 (which logs a console error and can stall UI).
        if (/^localization\/[\w-]+\.json$/.test(relPath) && relPath !== 'localization/en.json') {
          try {
            const fb = readEngineFile('localization/en.json');
            const headers = { 'Content-Type': engineContentTypeFor('localization/en.json'), 'Cache-Control': MODERATE_CACHE };
            if (typeof fb.size === 'number') headers['Content-Length'] = String(fb.size);
            res.writeHead(200, headers);
            if (fb.stream) return fb.stream.pipe(res);
            return res.end(fb.buffer);
          } catch { /* fall through to 404 */ }
        }
        return res.status(404).json({ error: 'not found' });
      }
      logger.error('emulator.engine.error', { relPath, error: err.message });
      res.status(500).json({ error: 'internal error' });
    }
  });

  // ---- GET /library --------------------------------------------------------
  router.get('/library', (req, res) => {
    try {
      const cfg = loadConfig();
      const { systems, consoles } = buildCatalog(cfg, logger);
      const user = req.query.user ? safeSegment(String(req.query.user)) : null;

      const games = (cfg.games ?? [])
        .filter((g) => g.system in systems)
        .map((g) => {
          const rules = resolveGameRules(cfg, g.id, user) ?? {};
          return {
            id: g.id,
            system: g.system,
            title: g.title,
            saveMode: rules.saveMode ?? 'none',
            core: rules.core ?? null,
            governance: rules.governance ?? null,
            shader: rules.shader ?? null,
            chrome: rules.chrome ?? null,
            native: rules.native ?? null,
            presentation: rules.presentation ?? null,
            romUrl: `/api/v1/emulator/rom/${g.system}/${g.id}`,
            coverUrl: `/api/v1/emulator/art/${g.system}/${g.id}/cover`,
            bezelUrl: `/api/v1/emulator/art/${g.system}/${g.id}/bezel`,
          };
        });

      res.json({ systems, consoles, games, input: cfg.input ?? null, settings: cfg.settings ?? null });
    } catch (err) {
      if (/unsafe path segment/.test(err.message)) return res.status(400).json({ error: 'bad request' });
      logger.error('emulator.library.error', { error: err.message });
      res.status(500).json({ error: 'internal error' });
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
      const cfg = loadConfig();
      const absPath = resolveRomPath(cfg, system, gameId);
      let result = readBinary(absPath);
      const range = parseRange(req.headers.range, result.size);
      if (range) result = readBinary(absPath, { range });
      sendBinary(res, result, { range, cache: true });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
      logger.error('emulator.rom.error', { system, gameId, error: err.message });
      res.status(500).json({ error: 'internal error' });
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
      const cfg = loadConfig();
      const absPath = resolveArtPath(cfg, system, gameId, kind);
      const result = readBinary(absPath);
      // Moderate (not immutable): art may be swapped under the same URL.
      sendBinary(res, result, { cache: MODERATE_CACHE });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
      logger.error('emulator.art.error', { system, gameId, kind, error: err.message });
      res.status(500).json({ error: 'internal error' });
    }
  });

  // ---- save / state read/write helpers ------------------------------------
  const rawBody = express.raw({ type: '*/*', limit: '8mb' });

  function readUserBlob(req, res, resolvePath) {
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
      const absPath = resolvePath({ system, gameId, slot, user });
      const result = readBinary(absPath);
      sendBinary(res, result, { cache: false });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(204).end();
      logger.error('emulator.blob.read_error', { system, gameId, slot, error: err.message });
      res.status(500).json({ error: 'internal error' });
    }
  }

  async function writeUserBlob(req, res, resolvePath) {
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
      const absPath = resolvePath({ system, gameId, slot, user });
      await writeBinary(absPath, body);
      res.json({ ok: true, bytes: body.length });
    } catch (err) {
      logger.error('emulator.blob.write_error', { system, gameId, slot, error: err.message });
      res.status(500).json({ error: 'internal error' });
    }
  }

  async function deleteUserBlob(req, res, resolvePath) {
    let system, gameId, slot, user;
    try {
      system = safeSegment(req.params.system);
      gameId = safeSegment(req.params.gameId);
      if (req.params.slot !== undefined) slot = safeSegment(req.params.slot, { dot: true });
      user = safeSegment(String(req.query.user ?? ''));
    } catch {
      return res.status(400).json({ error: 'bad request' });
    }
    if (typeof deleteBinary !== 'function') {
      return res.status(500).json({ error: 'delete unsupported' });
    }
    try {
      const absPath = resolvePath({ system, gameId, slot, user });
      await deleteBinary(absPath); // idempotent — missing file is a no-op
      res.json({ ok: true });
    } catch (err) {
      logger.error('emulator.blob.delete_error', { system, gameId, slot, error: err.message });
      res.status(500).json({ error: 'internal error' });
    }
  }

  // ---- saves ---------------------------------------------------------------
  router.get('/save/:system/:gameId', (req, res) =>
    readUserBlob(req, res, ({ system, gameId, user }) => resolveSavePath(system, gameId, user))
  );
  router.put('/save/:system/:gameId', rawBody, (req, res) =>
    writeUserBlob(req, res, ({ system, gameId, user }) => resolveSavePath(system, gameId, user))
  );
  router.delete('/save/:system/:gameId', (req, res) =>
    deleteUserBlob(req, res, ({ system, gameId, user }) => resolveSavePath(system, gameId, user))
  );

  // ---- states --------------------------------------------------------------
  router.get('/state/:system/:gameId/:slot', (req, res) =>
    readUserBlob(req, res, ({ system, gameId, slot, user }) => resolveStatePath(system, gameId, slot, user))
  );
  router.put('/state/:system/:gameId/:slot', rawBody, (req, res) =>
    writeUserBlob(req, res, ({ system, gameId, slot, user }) => resolveStatePath(system, gameId, slot, user))
  );
  router.delete('/state/:system/:gameId/:slot', (req, res) =>
    deleteUserBlob(req, res, ({ system, gameId, slot, user }) => resolveStatePath(system, gameId, slot, user))
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
    if (typeof listSaveUsers !== 'function') return res.json({ users: [] });
    try {
      const cfg = loadConfig();
      const rules = resolveGameRules(cfg, gameId, null) ?? {};
      const saveMode = rules.saveMode ?? 'none';
      if (saveMode === 'none') return res.json({ users: [] });
      res.json({ users: listSaveUsers(system, gameId) });
    } catch (err) {
      logger.error('emulator.saves.error', { system, gameId, error: err.message });
      res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}
