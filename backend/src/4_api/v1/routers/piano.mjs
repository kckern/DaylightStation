import express from 'express';
import { shortId } from '#domains/core/utils/id.mjs';
import { asyncHandler, errorHandlerMiddleware } from '#system/http/middleware/index.mjs';
import { musicXmlToNotes } from '#shared/music/musicXmlToNotes.mjs';

/**
 * Piano kiosk API.
 *
 * Per-user, not per-device: the piano has a roster (household.yml → users,
 * mirroring fitness) and each player gets their own recordings, lesson progress,
 * and preferences under data/users/{id}/apps/piano/. The browser owns Web-MIDI;
 * this layer is plain CRUD.
 *
 * Persistence + path building live in the injected PianoContainer's
 * `studioDatastore` (YamlPianoStudioDatastore); the two orchestrating course
 * algorithms live in the container's GetCourseProgress / GetPlayableUnits use
 * cases. This router is thin: input validation + delegation + response shaping.
 * URL paths and response bodies are contract-stable (the kiosk depends on them —
 * see docs/reference/piano/producer.md).
 *
 * Routes (mounted at /api/v1/piano):
 *   GET    /users                          → [{ id, name, group_label }]  (roster)
 *
 *   Studio takes (recordings), scoped to a user:
 *   GET    /users/:userId/studio           → { takes: [{id,title,created,durationMs,eventCount,favorite}] }
 *   GET    /users/:userId/studio/:id        → full take (events)
 *   POST   /users/:userId/studio            → { id, ... }  (body: { title, durationMs, events })
 *   PATCH  /users/:userId/studio/:id        → curate (body: { title?, favorite? })
 *   DELETE /users/:userId/studio/:id        → { ok, id }
 *
 *   Compositions (Composer mode), scoped to a user:
 *   GET    /users/:userId/compositions          → { compositions: [{id,title,tags,share,updatedAt,revision}] }
 *   GET    /users/:userId/compositions/:id       → { meta, musicxml }
 *   POST   /users/:userId/compositions           → 201 record  (body: { title, musicxml, meta }; 400 on invalid xml)
 *   PUT    /users/:userId/compositions/:id       → { ok, revision }  (body: { musicxml, meta, revision }; 400 invalid xml, 409 stale revision)
 *   DELETE /users/:userId/compositions/:id       → { ok, id }
 *   GET    /compositions/shared                  → { compositions: [{userId,id,title,tags}] }  (household pool)
 *
 *   Preferences (voice, shaders, etc.) — opaque per-user blob:
 *   GET    /users/:userId/preferences       → { ...prefs }
 *   PUT    /users/:userId/preferences        → { ...prefs }  (body merged)
 *
 *   Sound preset (default voice/effects/volume + saved favorites) — opaque per-user blob:
 *   GET    /users/:userId/preset             → { default?, favorites? }
 *   PUT    /users/:userId/preset             → { default?, favorites? }  (body merged)
 *
 *   Lesson progress / history:
 *   GET    /users/:userId/progress           → { collections: { [collection]: { [drillId]: {...} } } }
 *   PUT    /users/:userId/progress/:collection/:drillId → record an attempt (body merged)
 *
 *   Lesson drills (content, read-only):
 *   GET    /lessons/:collection              → index
 *   GET    /lessons/:collection/:id          → drill module
 */
export function createPianoRouter({ pianoContainer, logger = console }) {
  if (!pianoContainer) throw new Error('createPianoRouter: pianoContainer required');
  const router = express.Router();
  const ds = pianoContainer.studioDatastore;
  const cs = pianoContainer.composerSongStore;

  // Pure, config-free path-segment guards (HTTP input validation stays here).
  const safeSegment = (s) => typeof s === 'string' && s.length > 0 && !s.includes('/') && !s.includes('\\') && !s.includes('..');

  // Write-gate: reject a musicxml payload the app can't read back. The real bar
  // (spec §4) is "well-formed score", NOT "has notes" — a brand-new song from
  // NewSongSetup's makeEmptyScore() is a valid score with 0 notes and must be
  // accepted. musicXmlToNotes is a permissive regex scanner: it does NOT throw
  // on garbage (e.g. '<not-a-score/>' silently parses to `{notes:[]}`, same
  // shape as a valid empty score), so "doesn't throw" can't discriminate the
  // two — verified via a direct call. The real discriminator is structural:
  // every genuine score carries the <score-partwise> root element; garbage
  // doesn't.
  const isValidScore = (xml) => {
    if (typeof xml !== 'string' || !xml.includes('<score-partwise')) return false;
    try { musicXmlToNotes(xml); return true; }
    catch { return false; }
  };

  // ── Roster ────────────────────────────────────────────────────────────────
  router.get('/users', asyncHandler((req, res) => {
    res.json({ users: ds.getRoster() });
  }));

  // Loop-library manifest: walk the five MusicXML brick folders, bake per-beat
  // harmonic timelines (root-0, canonical-C), cache by folder mtime. This is the
  // ONE index fetch useLoopLibrary makes; individual bricks stream + parse lazily.
  router.get('/loop-manifest', asyncHandler((req, res) => {
    const bricks = ds.getLoopManifest({ refresh: req.query.refresh === 'true' });
    res.json({ bricks, count: bricks.length });
  }));

  // ── Studio takes (per-user) ─────────────────────────────────────────────────
  router.get('/users/:userId/studio', asyncHandler((req, res) => {
    const takes = ds.listStudioTakes(req.params.userId);
    if (takes === null) return res.status(400).json({ error: 'Invalid user' });
    res.json({ takes });
  }));

  router.get('/users/:userId/studio/:id', (req, res) => {
    if (!ds.isKnownUser(req.params.userId) || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const data = ds.getStudioTake(req.params.userId, req.params.id);
    if (!data) return res.status(404).json({ error: 'Take not found' });
    res.json(data);
  });

  router.post('/users/:userId/studio', asyncHandler((req, res) => {
    if (!ds.isKnownUser(req.params.userId)) return res.status(400).json({ error: 'Invalid user' });
    const { title, durationMs, events } = req.body || {};
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events (non-empty array) required' });
    }
    const id = shortId();
    const data = {
      id,
      userId: req.params.userId,
      title: title || `Take ${id}`,
      created: new Date().toISOString(),
      durationMs: Number(durationMs) || 0,
      events,
    };
    ds.saveStudioTake(req.params.userId, id, data);
    logger.info?.('piano.studio.save', { userId: req.params.userId, id, events: events.length });
    res.status(201).json(data);
  }));

  router.patch('/users/:userId/studio/:id', asyncHandler((req, res) => {
    if (!ds.isKnownUser(req.params.userId) || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const data = ds.getStudioTake(req.params.userId, req.params.id);
    if (!data) return res.status(404).json({ error: 'Take not found' });
    const { title, favorite } = req.body || {};
    if (typeof title === 'string' && title.trim()) data.title = title.trim();
    if (typeof favorite === 'boolean') data.favorite = favorite;
    ds.saveStudioTake(req.params.userId, req.params.id, data);
    res.json({ id: req.params.id, title: data.title, favorite: !!data.favorite });
  }));

  router.delete('/users/:userId/studio/:id', (req, res) => {
    if (!ds.isKnownUser(req.params.userId) || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const deleted = ds.deleteStudioTake(req.params.userId, req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Take not found' });
    res.json({ ok: true, id: req.params.id });
  });

  // ── Compositions (Composer mode, per-user) ──────────────────────────────────
  router.get('/users/:userId/compositions', asyncHandler((req, res) => {
    const list = cs.list(req.params.userId);
    if (list === null) {
      logger.warn?.('composer.song.list-invalid-user', { userId: req.params.userId });
      return res.status(400).json({ error: 'Invalid user' });
    }
    logger.info?.('composer.song.list', { userId: req.params.userId, count: list.length });
    res.json({ compositions: list });
  }));

  router.get('/users/:userId/compositions/:id', asyncHandler((req, res) => {
    const got = cs.get(req.params.userId, req.params.id);
    if (!got) {
      logger.warn?.('composer.song.get-not-found', { userId: req.params.userId, id: req.params.id });
      return res.status(404).json({ error: 'Not found' });
    }
    logger.info?.('composer.song.get', { userId: req.params.userId, id: req.params.id, revision: got.meta?.revision, xmlLen: got.musicxml?.length || 0 });
    res.json(got);
  }));

  router.post('/users/:userId/compositions', asyncHandler((req, res) => {
    if (!cs.isKnownUser(req.params.userId)) {
      logger.warn?.('composer.song.create-invalid-user', { userId: req.params.userId });
      return res.status(400).json({ error: 'Invalid user' });
    }
    const { title, musicxml, meta } = req.body || {};
    if (!isValidScore(musicxml)) {
      logger.warn?.('composer.song.create-invalid-xml', { userId: req.params.userId, xmlLen: musicxml?.length || 0 });
      return res.status(400).json({ error: 'musicxml must be a valid score' });
    }
    const rec = cs.create(req.params.userId, { title, musicxml, meta });
    logger.info?.('composer.song.create', { userId: req.params.userId, id: rec?.id, title: rec?.title, revision: rec?.revision });
    res.status(201).json(rec);
  }));

  router.put('/users/:userId/compositions/:id', asyncHandler((req, res) => {
    const { musicxml, meta, revision } = req.body || {};
    if (!isValidScore(musicxml)) {
      logger.warn?.('composer.song.save-invalid-xml', { userId: req.params.userId, id: req.params.id });
      return res.status(400).json({ error: 'musicxml failed validation' });
    }
    const r = cs.save(req.params.userId, req.params.id, { musicxml, meta, revision });
    if (r.conflict) {
      logger.warn?.('composer.song.save-conflict', { userId: req.params.userId, id: req.params.id, sentRevision: revision, current: r.current });
      return res.status(409).json({ error: 'revision conflict', current: r.current });
    }
    logger.info?.('composer.song.save', { userId: req.params.userId, id: req.params.id, revision: r.revision, xmlLen: musicxml?.length || 0 });
    res.json(r);
  }));

  router.delete('/users/:userId/compositions/:id', asyncHandler((req, res) => {
    const ok = cs.remove(req.params.userId, req.params.id);
    logger.info?.('composer.song.delete', { userId: req.params.userId, id: req.params.id, ok });
    res.json({ ok, id: req.params.id });
  }));

  router.get('/compositions/shared', asyncHandler((req, res) => {
    res.json({ compositions: cs.listShared() });
  }));

  // ── Producer (household pool, author-tagged) ────────────────────────────────
  // Unlike Studio (per-user), the Producer crate is a shared household pool: loops,
  // stacks/sections, and crystallized songs anyone kept, each tagged with the author
  // (current-player userId from the kiosk — trusted from the body per design §6).
  //
  // Ids MUST be dot-free ([a-z0-9-]): FileIO/DataService append `.yml` by inspecting
  // the trailing extension, so a dot in the id would corrupt the filename (MEMORY.md).
  // The same charset also blocks `/`, `\`, `..` and uppercase → no path traversal.
  const PRODUCER_ID_RE = /^[a-z0-9-]{1,64}$/;
  // Required top-level payload field per family (the "heavy" note/layer/section data).
  const PRODUCER_REQUIRED = { loops: 'notes', crate: 'layers', songs: 'sections' };

  // Light listing projector: identity + kind + author + a small family signature —
  // never the heavy note/layer/section payload (those load on demand via GET :id).
  const producerLight = (family, id, data) => {
    const light = {
      id,
      kind: data.kind ?? null,
      author: data.author ?? null,
      created: data.created ?? null,
    };
    if (data.title != null) light.title = data.title;
    if (typeof data.favorite === 'boolean') light.favorite = data.favorite;
    if (family === 'loops') {
      light.ppq = data.ppq ?? null;
      light.lengthBars = data.lengthBars ?? null;
      if (data.specificity != null) light.specificity = data.specificity;
      if (data.drumMode != null) light.drumMode = data.drumMode;
    } else if (family === 'crate') {
      light.lengthBars = data.lengthBars ?? null;
      light.layerCount = Array.isArray(data.layers) ? data.layers.length : 0;
    } else if (family === 'songs') {
      light.sectionCount = Array.isArray(data.sections) ? data.sections.length : 0;
      if (data.meta != null) light.meta = data.meta;
    }
    return light;
  };

  // Register the CRUD quintet per family in a loop. Because only the three known
  // families get routes, an unknown family (/producer/bogus) falls through to 404.
  for (const family of ['loops', 'crate', 'songs']) {
    const requiredField = PRODUCER_REQUIRED[family];
    const bad = (res, error) => res.status(400).json({ error });

    // GET /producer/{family} → light listing (household pool, no author filter).
    router.get(`/producer/${family}`, asyncHandler((req, res) => {
      const items = ds.listProducer(family).map(({ id, data }) => producerLight(family, id, data));
      res.json({ items });
    }));

    // GET /producer/{family}/:id → full record.
    router.get(`/producer/${family}/:id`, (req, res) => {
      if (!PRODUCER_ID_RE.test(req.params.id)) return bad(res, 'Invalid id');
      const data = ds.getProducer(family, req.params.id);
      if (!data) return res.status(404).json({ error: `${family} record not found` });
      res.json(data);
    });

    // POST /producer/{family} → create (server-generated dot-free id).
    router.post(`/producer/${family}`, asyncHandler((req, res) => {
      const payload = (req.body && typeof req.body === 'object') ? req.body : {};
      const author = typeof payload.author === 'string' ? payload.author.trim() : '';
      if (!author) return bad(res, 'author (non-empty string) required');
      if (!Array.isArray(payload[requiredField]) || payload[requiredField].length === 0) {
        return bad(res, `${requiredField} (non-empty array) required`);
      }
      // shortId() draws from a mixed-case charset; producer ids must be dot-free
      // AND match [a-z0-9-], so lowercase it (collision-safe at 10 chars).
      const id = shortId().toLowerCase();
      const data = {
        ...payload,
        id,
        author,
        created: new Date().toISOString(),
      };
      ds.saveProducer(family, id, data);
      logger.info?.('piano.producer.save', { family, id, author });
      res.status(201).json(data);
    }));

    // PATCH /producer/{family}/:id → partial curate (title/favorite + shallow merge).
    router.patch(`/producer/${family}/:id`, asyncHandler((req, res) => {
      if (!PRODUCER_ID_RE.test(req.params.id)) return bad(res, 'Invalid id');
      const data = ds.getProducer(family, req.params.id);
      if (!data) return res.status(404).json({ error: `${family} record not found` });
      const patch = (req.body && typeof req.body === 'object') ? req.body : {};
      // Never let a patch rewrite identity/provenance.
      const { id: _id, author: _author, created: _created, ...mergeable } = patch;
      Object.assign(data, mergeable);
      if (typeof patch.title === 'string' && patch.title.trim()) data.title = patch.title.trim();
      if (typeof patch.favorite === 'boolean') data.favorite = patch.favorite;
      ds.saveProducer(family, req.params.id, data);
      res.json({ id: req.params.id, title: data.title ?? null, favorite: !!data.favorite });
    }));

    // DELETE /producer/{family}/:id → { ok, id }.
    router.delete(`/producer/${family}/:id`, (req, res) => {
      if (!PRODUCER_ID_RE.test(req.params.id)) return bad(res, 'Invalid id');
      const deleted = ds.deleteProducer(family, req.params.id);
      if (!deleted) return res.status(404).json({ error: `${family} record not found` });
      res.json({ ok: true, id: req.params.id });
    });
  }

  // ── Preferences (per-user opaque blob) ──────────────────────────────────────
  router.get('/users/:userId/preferences', (req, res) => {
    const prefs = ds.getPreferences(req.params.userId);
    if (prefs === null) return res.status(400).json({ error: 'Invalid user' });
    res.json(prefs);
  });

  router.put('/users/:userId/preferences', asyncHandler((req, res) => {
    const current = ds.getPreferences(req.params.userId);
    if (current === null) return res.status(400).json({ error: 'Invalid user' });
    const merged = { ...current, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    ds.savePreferences(req.params.userId, merged);
    res.json(merged);
  }));

  // ── Sound preset (per-user opaque blob: { default, favorites }) ────────────
  router.get('/users/:userId/preset', (req, res) => {
    const preset = ds.getPreset(req.params.userId);
    if (preset === null) return res.status(400).json({ error: 'Invalid user' });
    res.json(preset);
  });

  router.put('/users/:userId/preset', asyncHandler((req, res) => {
    const current = ds.getPreset(req.params.userId);
    if (current === null) return res.status(400).json({ error: 'Invalid user' });
    const merged = { ...current, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    ds.savePreset(req.params.userId, merged);
    res.json(merged);
  }));

  // ── Lesson progress / history (per-user) ────────────────────────────────────
  router.get('/users/:userId/progress', (req, res) => {
    const progress = ds.getProgress(req.params.userId);
    if (progress === null) return res.status(400).json({ error: 'Invalid user' });
    res.json(progress);
  });

  router.put('/users/:userId/progress/:collection/:drillId', asyncHandler((req, res) => {
    const { userId, collection, drillId } = req.params;
    if (!ds.isKnownUser(userId) || !safeSegment(collection) || !safeSegment(drillId)) {
      return res.status(400).json({ error: 'Invalid params' });
    }
    const progress = ds.getProgress(userId) || { collections: {} };
    if (!progress.collections) progress.collections = {};
    const col = progress.collections[collection] || (progress.collections[collection] = {});
    const prev = col[drillId] || {};
    col[drillId] = {
      ...prev,
      ...(req.body && typeof req.body === 'object' ? req.body : {}),
      lastPlayed: new Date().toISOString(),
      plays: (prev.plays || 0) + 1,
    };
    ds.saveProgress(userId, progress);
    logger.info?.('piano.progress.record', { userId, collection, drillId });
    res.json(col[drillId]);
  }));

  // ── Lesson drills (content, read-only) ──────────────────────────────────────
  const safeDrillId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

  router.get('/lessons/:collection', asyncHandler((req, res) => {
    if (!safeSegment(req.params.collection)) return res.status(400).json({ error: 'Invalid collection' });
    const data = ds.getLessonIndex(req.params.collection);
    if (!data) return res.status(404).json({ error: 'Lesson collection not found' });
    res.json(data);
  }));

  router.get('/lessons/:collection/:id', asyncHandler((req, res) => {
    if (!safeSegment(req.params.collection) || !safeDrillId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const data = ds.getLessonDrill(req.params.collection, req.params.id);
    if (!data) return res.status(404).json({ error: 'Drill not found' });
    res.json(data);
  }));

  // ── Course video playable (per-user) ────────────────────────────────────────
  // Per-course roster progress for the poster wall: for each requested course id,
  // returns { isSequential, total, users:[{id,name,completed,total,lastPlayedAt}] }.
  router.get('/courses/progress', asyncHandler(async (req, res) => {
    if (!pianoContainer.isCourseServiceConfigured()) {
      return res.status(503).json({ error: 'Piano course service not configured' });
    }
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    const { courses } = await pianoContainer.getCourseProgress().execute({ ids });
    res.json({ courses });
  }));

  router.get('/courses/:courseId/playable', asyncHandler(async (req, res) => {
    if (!pianoContainer.isCourseServiceConfigured()) {
      return res.status(503).json({ error: 'Piano course service not configured' });
    }
    const outcome = await pianoContainer.getPlayableUnits().execute({
      courseId: req.params.courseId,
      userId: req.query.userId,
    });
    if (!outcome.ok && outcome.reason === 'invalid_user') {
      return res.status(400).json({ error: 'Invalid user' });
    }
    res.json(outcome.result);
  }));

  // ── Always-on MIDI history (.mid per user/date) ─────────────────────────────
  // History lives at the HOUSEHOLD level (not data/users), and accepts `guest`
  // (the dismiss-outcome identity) in addition to known roster users.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TAKE_RE = /^[0-9][0-9.\-]{1,30}$/;            // HH.MM.SS or HH.MM.SS-2
  const historyUser = (u) => u === 'guest' || ds.isKnownUser(u);

  router.put('/users/:userId/history/:date/:takeId', asyncHandler(async (req, res) => {
    const { userId, date, takeId } = req.params;
    if (!historyUser(userId)) return res.status(400).json({ error: 'Invalid user' });
    if (!DATE_RE.test(date) || !TAKE_RE.test(takeId) || takeId.includes('..')) {
      return res.status(400).json({ error: 'Invalid date/take' });
    }
    const { events } = req.body || {};
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events (non-empty array) required' });
    }
    const { bytes, path: file } = ds.writeHistoryMidi(userId, date, takeId, events);
    logger.info?.('piano.history.write', { userId, date, takeId, events: events.length, bytes });
    res.json({ ok: true, bytes, path: file });
  }));

  // ── Effect audit (autonomous reverb/chorus audibility test) ────────────────
  // The harness page POSTs each recorded clip as raw audio/webm, then POSTs a
  // manifest. Both land under media/logs/piano/effect-audit/<runId>/ (survives
  // redeploys, like the per-session JSONL logs).
  const SAFE_SEG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // no slashes, no leading dot/dash
  const rawAudio = express.raw({ type: ['audio/webm', 'application/octet-stream'], limit: '25mb' });

  router.post('/effect-audit/:runId/clip/:label', rawAudio, (req, res) => {
    const { runId, label } = req.params;
    if (!SAFE_SEG.test(runId) || !SAFE_SEG.test(label)) {
      return res.status(400).json({ error: 'Invalid runId/label' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Empty audio body' });
    }
    const { bytes, path: file } = ds.writeEffectAuditClip(runId, label, req.body);
    logger.info?.('piano.effect-audit.clip', { runId, label, bytes });
    res.status(201).json({ ok: true, bytes, path: file });
  });

  router.post('/effect-audit/:runId/manifest', (req, res) => {
    const { runId } = req.params;
    if (!SAFE_SEG.test(runId)) return res.status(400).json({ error: 'Invalid runId' });
    const manifest = req.body;
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.clips)) {
      return res.status(400).json({ error: 'manifest.clips (array) required' });
    }
    const { clips, path: file } = ds.writeEffectAuditManifest(runId, manifest);
    logger.info?.('piano.effect-audit.manifest', { runId, clips });
    res.status(201).json({ ok: true, clips, path: file });
  });

  // Expected errors → { error: "<message>", code }; unexpected 500s → hidden.
  router.use(errorHandlerMiddleware({ shape: 'string' }));

  return router;
}

export default createPianoRouter;
