import express from 'express';
import path from 'path';
import {
  loadYaml,
  saveYaml,
  listYamlFiles,
  deleteYaml,
  ensureDir,
  writeBinary,
} from '#system/utils/FileIO.mjs';
import { shortId } from '#domains/core/utils/id.mjs';
import { userService } from '#system/config/UserService.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { encodeMidiFile } from '#applications/piano/midiFile.mjs';
import { excludeReferenceUnits, isRecent, rankAndCapUsers } from '#applications/piano/courseProgress.mjs';
import { getManifest } from '#applications/piano/loopManifest.mjs';

/**
 * Piano kiosk API.
 *
 * Per-user, not per-device: the piano has a roster (piano.yml → users.primary,
 * mirroring fitness) and each player gets their own recordings, lesson progress,
 * and preferences under data/users/{id}/apps/piano/. The browser owns Web-MIDI;
 * this layer is plain CRUD.
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
 *   Preferences (voice, shaders, etc.) — opaque per-user blob:
 *   GET    /users/:userId/preferences       → { ...prefs }
 *   PUT    /users/:userId/preferences        → { ...prefs }  (body merged)
 *
 *   Lesson progress / history:
 *   GET    /users/:userId/progress           → { collections: { [collection]: { [drillId]: {...} } } }
 *   PUT    /users/:userId/progress/:collection/:drillId → record an attempt (body merged)
 *
 *   Lesson drills (content, read-only):
 *   GET    /lessons/:collection              → index
 *   GET    /lessons/:collection/:id          → drill module
 */
export function createPianoRouter({ configService, fitnessPlayableService = null, userVideoProgressStore = null, logger = console }) {
  const router = express.Router();

  const safeSegment = (s) => typeof s === 'string' && s.length > 0 && !s.includes('/') && !s.includes('\\') && !s.includes('..');
  // A userId must be a real, known user (guards arbitrary dir creation).
  const knownUser = (userId) => safeSegment(userId) && !!configService.getUserProfile(userId);
  const userPianoDir = (userId, ...sub) => (knownUser(userId) ? path.join(configService.getUserDir(userId), 'apps', 'piano', ...sub) : null);

  // ── Roster ────────────────────────────────────────────────────────────────
  router.get('/users', (req, res) => {
    try {
      const cfg = configService.getHouseholdAppConfig(null, 'piano') || {};
      const primary = Array.isArray(cfg.users?.primary) ? cfg.users.primary : [];
      const users = userService.hydrateUsers(primary).map((u) => ({
        id: u.id,
        name: u.name,
        group_label: u.group_label || null,
      }));
      res.json({ users });
    } catch (err) {
      logger.error?.('piano.users.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // Loop-library manifest: walk the five MusicXML brick folders, bake per-beat
  // harmonic timelines (root-0, canonical-C), cache by folder mtime. This is the
  // ONE index fetch useLoopLibrary makes; individual bricks stream + parse lazily.
  router.get('/loop-manifest', (req, res) => {
    try {
      const midiDir = path.join(configService.getMediaDir(), 'midi');
      const bricks = getManifest(midiDir, { refresh: req.query.refresh === 'true' });
      res.json({ bricks, count: bricks.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Studio takes (per-user) ─────────────────────────────────────────────────
  router.get('/users/:userId/studio', (req, res) => {
    try {
      const dir = userPianoDir(req.params.userId, 'studio');
      if (!dir) return res.status(400).json({ error: 'Invalid user' });
      const takes = listYamlFiles(dir).map((id) => {
        const data = loadYaml(path.join(dir, id)) || {};
        return {
          id,
          title: data.title || id,
          created: data.created || null,
          durationMs: data.durationMs || 0,
          eventCount: Array.isArray(data.events) ? data.events.length : 0,
          favorite: !!data.favorite,
        };
      });
      res.json({ takes });
    } catch (err) {
      logger.error?.('piano.studio.list.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/users/:userId/studio/:id', (req, res) => {
    const dir = userPianoDir(req.params.userId, 'studio');
    if (!dir || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const data = loadYaml(path.join(dir, req.params.id));
    if (!data) return res.status(404).json({ error: 'Take not found' });
    res.json(data);
  });

  router.post('/users/:userId/studio', (req, res) => {
    try {
      const dir = userPianoDir(req.params.userId, 'studio');
      if (!dir) return res.status(400).json({ error: 'Invalid user' });
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
      saveYaml(path.join(dir, id), data);
      logger.info?.('piano.studio.save', { userId: req.params.userId, id, events: events.length });
      res.status(201).json(data);
    } catch (err) {
      logger.error?.('piano.studio.create.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/users/:userId/studio/:id', (req, res) => {
    try {
      const dir = userPianoDir(req.params.userId, 'studio');
      if (!dir || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
      const data = loadYaml(path.join(dir, req.params.id));
      if (!data) return res.status(404).json({ error: 'Take not found' });
      const { title, favorite } = req.body || {};
      if (typeof title === 'string' && title.trim()) data.title = title.trim();
      if (typeof favorite === 'boolean') data.favorite = favorite;
      saveYaml(path.join(dir, req.params.id), data);
      res.json({ id: req.params.id, title: data.title, favorite: !!data.favorite });
    } catch (err) {
      logger.error?.('piano.studio.update.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/users/:userId/studio/:id', (req, res) => {
    const dir = userPianoDir(req.params.userId, 'studio');
    if (!dir || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const deleted = deleteYaml(path.join(dir, req.params.id));
    if (!deleted) return res.status(404).json({ error: 'Take not found' });
    res.json({ ok: true, id: req.params.id });
  });

  // ── Producer (household pool, author-tagged) ────────────────────────────────
  // Unlike Studio (per-user), the Producer crate is a shared household pool: loops,
  // stacks/sections, and crystallized songs anyone kept, each tagged with the author
  // (current-player userId from the kiosk — trusted from the body per design §6).
  // Stored under <householdDataDir>/apps/piano/producer/{family}/{id}.yml.
  //
  // Ids MUST be dot-free ([a-z0-9-]): FileIO/DataService append `.yml` by inspecting
  // the trailing extension, so a dot in the id would corrupt the filename (MEMORY.md).
  // The same charset also blocks `/`, `\`, `..` and uppercase → no path traversal.
  const PRODUCER_ID_RE = /^[a-z0-9-]{1,64}$/;
  // Required top-level payload field per family (the "heavy" note/layer/section data).
  const PRODUCER_REQUIRED = { loops: 'notes', crate: 'layers', songs: 'sections' };
  const producerDir = (family) => configService.getHouseholdPath(path.join('apps', 'piano', 'producer', family));

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
    router.get(`/producer/${family}`, (req, res) => {
      try {
        const dir = producerDir(family);
        const items = listYamlFiles(dir).map((id) => {
          const data = loadYaml(path.join(dir, id)) || {};
          return producerLight(family, id, data);
        });
        res.json({ items });
      } catch (err) {
        logger.error?.('piano.producer.list.error', { family, error: err.message });
        res.status(500).json({ error: err.message });
      }
    });

    // GET /producer/{family}/:id → full record.
    router.get(`/producer/${family}/:id`, (req, res) => {
      if (!PRODUCER_ID_RE.test(req.params.id)) return bad(res, 'Invalid id');
      const data = loadYaml(path.join(producerDir(family), req.params.id));
      if (!data) return res.status(404).json({ error: `${family} record not found` });
      res.json(data);
    });

    // POST /producer/{family} → create (server-generated dot-free id).
    router.post(`/producer/${family}`, (req, res) => {
      try {
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
        saveYaml(path.join(producerDir(family), id), data);
        logger.info?.('piano.producer.save', { family, id, author });
        res.status(201).json(data);
      } catch (err) {
        logger.error?.('piano.producer.create.error', { family, error: err.message });
        res.status(500).json({ error: err.message });
      }
    });

    // PATCH /producer/{family}/:id → partial curate (title/favorite + shallow merge).
    router.patch(`/producer/${family}/:id`, (req, res) => {
      try {
        if (!PRODUCER_ID_RE.test(req.params.id)) return bad(res, 'Invalid id');
        const file = path.join(producerDir(family), req.params.id);
        const data = loadYaml(file);
        if (!data) return res.status(404).json({ error: `${family} record not found` });
        const patch = (req.body && typeof req.body === 'object') ? req.body : {};
        // Never let a patch rewrite identity/provenance.
        const { id: _id, author: _author, created: _created, ...mergeable } = patch;
        Object.assign(data, mergeable);
        if (typeof patch.title === 'string' && patch.title.trim()) data.title = patch.title.trim();
        if (typeof patch.favorite === 'boolean') data.favorite = patch.favorite;
        saveYaml(file, data);
        res.json({ id: req.params.id, title: data.title ?? null, favorite: !!data.favorite });
      } catch (err) {
        logger.error?.('piano.producer.update.error', { family, error: err.message });
        res.status(500).json({ error: err.message });
      }
    });

    // DELETE /producer/{family}/:id → { ok, id }.
    router.delete(`/producer/${family}/:id`, (req, res) => {
      if (!PRODUCER_ID_RE.test(req.params.id)) return bad(res, 'Invalid id');
      const deleted = deleteYaml(path.join(producerDir(family), req.params.id));
      if (!deleted) return res.status(404).json({ error: `${family} record not found` });
      res.json({ ok: true, id: req.params.id });
    });
  }

  // ── Preferences (per-user opaque blob) ──────────────────────────────────────
  router.get('/users/:userId/preferences', (req, res) => {
    const dir = userPianoDir(req.params.userId);
    if (!dir) return res.status(400).json({ error: 'Invalid user' });
    res.json(loadYaml(path.join(dir, 'preferences')) || {});
  });

  router.put('/users/:userId/preferences', (req, res) => {
    try {
      const dir = userPianoDir(req.params.userId);
      if (!dir) return res.status(400).json({ error: 'Invalid user' });
      const current = loadYaml(path.join(dir, 'preferences')) || {};
      const merged = { ...current, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
      saveYaml(path.join(dir, 'preferences'), merged);
      res.json(merged);
    } catch (err) {
      logger.error?.('piano.preferences.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Lesson progress / history (per-user) ────────────────────────────────────
  router.get('/users/:userId/progress', (req, res) => {
    const dir = userPianoDir(req.params.userId);
    if (!dir) return res.status(400).json({ error: 'Invalid user' });
    res.json(loadYaml(path.join(dir, 'progress')) || { collections: {} });
  });

  router.put('/users/:userId/progress/:collection/:drillId', (req, res) => {
    try {
      const dir = userPianoDir(req.params.userId);
      if (!dir || !safeSegment(req.params.collection) || !safeSegment(req.params.drillId)) {
        return res.status(400).json({ error: 'Invalid params' });
      }
      const progress = loadYaml(path.join(dir, 'progress')) || { collections: {} };
      if (!progress.collections) progress.collections = {};
      const col = progress.collections[req.params.collection] || (progress.collections[req.params.collection] = {});
      const prev = col[req.params.drillId] || {};
      col[req.params.drillId] = {
        ...prev,
        ...(req.body && typeof req.body === 'object' ? req.body : {}),
        lastPlayed: new Date().toISOString(),
        plays: (prev.plays || 0) + 1,
      };
      saveYaml(path.join(dir, 'progress'), progress);
      logger.info?.('piano.progress.record', { userId: req.params.userId, collection: req.params.collection, drillId: req.params.drillId });
      res.json(col[req.params.drillId]);
    } catch (err) {
      logger.error?.('piano.progress.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Lesson drills (content, read-only) ──────────────────────────────────────
  const lessonsRoot = path.join(configService.getMediaDir(), 'docs', 'piano-lessons');
  const lessonDir = (collection) => {
    if (!safeSegment(collection)) return null;
    const dir = path.join(lessonsRoot, collection);
    return dir.startsWith(lessonsRoot + path.sep) ? dir : null;
  };
  const safeDrillId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

  router.get('/lessons/:collection', (req, res) => {
    try {
      const dir = lessonDir(req.params.collection);
      if (!dir) return res.status(400).json({ error: 'Invalid collection' });
      const data = loadYaml(path.join(dir, 'index'));
      if (!data) return res.status(404).json({ error: 'Lesson collection not found' });
      res.json(data);
    } catch (err) {
      logger.error?.('piano.lessons.index.error', { collection: req.params.collection, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/lessons/:collection/:id', (req, res) => {
    try {
      const dir = lessonDir(req.params.collection);
      if (!dir || !safeDrillId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
      const data = loadYaml(path.join(dir, req.params.id));
      if (!data) return res.status(404).json({ error: 'Drill not found' });
      res.json(data);
    } catch (err) {
      logger.error?.('piano.lessons.read.error', { collection: req.params.collection, id: req.params.id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Course video playable (per-user) ────────────────────────────────────────
  // Per-course roster progress for the poster wall: for each requested course id,
  // returns { isSequential, total, users:[{id,name,completed,total,lastPlayedAt}] }.
  // Users are filtered to those with recent, sufficient progress (videos.progress_overlay)
  // and only populated for sequential courses (the overlay is a sequential affordance).
  router.get('/courses/progress', asyncHandler(async (req, res) => {
    if (!fitnessPlayableService) {
      return res.status(503).json({ error: 'Piano course service not configured' });
    }
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    const courses = {};
    if (ids.length === 0) return res.json({ courses });

    const pianoConfig = configService.getHouseholdAppConfig(null, 'piano') || {};
    const videos = pianoConfig.videos || {};
    const sequentialLabels = new Set((videos.sequential_labels || []).map((l) => String(l).toLowerCase()));
    const overlay = videos.progress_overlay || {};
    const recencyDays = overlay.recency_days ?? 7;
    const minCompleted = overlay.min_completed ?? 1;
    const maxAvatars = overlay.max_avatars ?? 4;
    const referenceUnits = videos.reference_units || [];

    const primary = Array.isArray(pianoConfig.users?.primary) ? pianoConfig.users.primary : [];
    const roster = primary
      .map((id) => { const p = configService.getUserProfile(id); return p ? { id, name: p.name } : null; })
      .filter(Boolean);
    const now = new Date();

    for (const courseId of ids) {
      let playable;
      try {
        // The playable service keys off the bare Plex rating key (the grid sends
        // `plex:`-prefixed ids); strip for the call, keep the original as the map key.
        playable = await fitnessPlayableService.getPlayableEpisodes(String(courseId).replace(/^plex:/, ''));
      } catch (err) {
        logger.warn?.('piano.courses.progress.fetch_error', { courseId, error: err.message });
        continue;
      }
      const labels = playable?.info?.labels;
      const isSequential = Array.isArray(labels) && labels.some((l) => sequentialLabels.has(String(l).toLowerCase()));
      const items = excludeReferenceUnits(playable?.items || [], courseId, referenceUnits);
      const total = items.length;

      let users = [];
      if (isSequential && userVideoProgressStore) {
        for (const u of roster) {
          const s = userVideoProgressStore.summarize(items, u.id);
          if (s.completed >= minCompleted && isRecent(s.lastPlayedAt, recencyDays, now)) {
            users.push({ id: u.id, name: u.name, completed: s.completed, total, lastPlayedAt: s.lastPlayedAt });
          }
        }
        users = rankAndCapUsers(users, maxAvatars);
      }
      courses[courseId] = { isSequential, total, users };
    }

    logger.info?.('piano.courses.progress', { ids: ids.length, courses: Object.keys(courses).length });
    res.json({ courses });
  }));

  router.get('/courses/:courseId/playable', asyncHandler(async (req, res) => {
    if (!fitnessPlayableService) {
      return res.status(503).json({ error: 'Piano course service not configured' });
    }

    const { courseId } = req.params;
    const { userId } = req.query;

    // `guest` is the who's-playing dismiss-outcome identity (it never has tracked
    // progress). Treat it like an anonymous request: serve the course + isSequential
    // with NO per-user enrichment, rather than rejecting it — otherwise an idle
    // kiosk that fell back to Guest would 400 here and the course would render blank.
    const isGuest = userId === 'guest';

    // Validate a real userId. Prefer the store's guard if wired, else the router's
    // knownUser() — both reject unknown users with 400 (guest is exempted above).
    if (userId && !isGuest) {
      const ok = userVideoProgressStore ? userVideoProgressStore.isKnownUser(userId) : knownUser(userId);
      if (!ok) return res.status(400).json({ error: 'Invalid user' });
    }

    const playable = await fitnessPlayableService.getPlayableEpisodes(courseId);

    // Surface the unit/season link at the item top-level. The shared playable
    // service nests it under `metadata.parentId/parentIndex/parentTitle`, but the
    // frontend's unit grouping (CourseDetail.episodesOf) keys off a top-level
    // `parentId` that matches the `parents` map. Without this lift, multi-unit
    // courses (e.g. Hoffman Academy's 18 units) render zero episodes per unit.
    if (Array.isArray(playable.items)) {
      playable.items = playable.items.map((it) => {
        const md = it?.metadata || {};
        return {
          ...it,
          parentId: it.parentId ?? md.parentId ?? null,
          parentIndex: it.parentIndex ?? md.parentIndex ?? null,
          parentTitle: it.parentTitle ?? md.parentTitle ?? null,
          // The episode number (E12 badge) and intra-unit sort key live under
          // metadata too; lift so the grid can label + order lectures correctly.
          itemIndex: it.itemIndex ?? md.itemIndex ?? null,
        };
      });
    }

    // Per-user progress enrichment (userPercent/userWatched/etc.) via the shared
    // store — known users only; guest/anonymous get the course with no progress.
    if (userId && !isGuest && userVideoProgressStore) {
      playable.items = userVideoProgressStore.enrich(playable.items, userId);
    }

    const pianoConfig = configService.getHouseholdAppConfig(null, 'piano') || {};
    const compoundId = playable.compoundId || `plex:${courseId}`;
    const sequentialLabels = new Set(
      (pianoConfig.videos?.sequential_labels || []).map((l) => l.toLowerCase())
    );
    const isSequential = Array.isArray(playable.info?.labels) &&
      playable.info.labels.some((l) => sequentialLabels.has(String(l).toLowerCase()));

    // Reference units: config-flagged units (by title pattern or explicit id) that
    // are never gated, give no progression credit, and render in the always-open
    // Practice & Reference zone. Matched per course against unit (season) titles.
    const referenceUnitIds = new Set();
    const refRule = (pianoConfig.videos?.reference_units || []).find((r) => r.courseId === compoundId);
    if (refRule) {
      const patterns = (refRule.titlePatterns || []).map((p) => String(p).toLowerCase()).filter(Boolean);
      const explicit = new Set((refRule.unitIds || []).map(String));
      for (const [pid, parent] of Object.entries(playable.parents || {})) {
        const title = String(parent?.title || '').toLowerCase();
        if (explicit.has(String(pid)) || patterns.some((pat) => title.includes(pat))) {
          referenceUnitIds.add(String(pid));
        }
      }
    }
    if (Array.isArray(playable.items)) {
      playable.items = playable.items.map((it) => ({
        ...it,
        isReference: referenceUnitIds.has(String(it.parentId)),
      }));
    }

    // Co-progress lock: in sequential courses with a configured user pair, block the
    // ahead user from the next episode until the gap falls below the buffer. Reference
    // episodes give no credit, so they're excluded from both users' counts.
    let coProgressLock = null;
    if (isSequential && userId && !isGuest && userVideoProgressStore) {
      const rules = pianoConfig.videos?.co_progress || [];
      const rule = rules.find(
        (r) => r.courseId === compoundId &&
               Array.isArray(r.users) &&
               r.users.includes(userId),
      );
      if (rule) {
        const isCredit = (it) => it.userWatched && !referenceUnitIds.has(String(it.parentId));
        const myCount = (playable.items || []).filter(isCredit).length;
        const partnerIds = rule.users.filter((u) => u !== userId);
        const partnerCounts = partnerIds.map((pid) => {
          if (!userVideoProgressStore.isKnownUser(pid)) return 0;
          const enriched = userVideoProgressStore.enrich(playable.items || [], pid);
          return enriched.filter(isCredit).length;
        });
        if (partnerCounts.length) {
          const minPartnerCount = Math.min(...partnerCounts);
          const aheadBy = myCount - minPartnerCount;
          if (aheadBy >= rule.buffer) {
            const slowestIndex = partnerCounts.indexOf(minPartnerCount);
            coProgressLock = {
              locked: true,
              aheadBy,
              waitingForId: partnerIds[slowestIndex],
              buffer: rule.buffer,
            };
          }
        }
      }
    }

    logger.info?.('piano.courses.playable', { courseId, userId: userId || null, isSequential });
    res.json({ ...playable, isSequential, coProgressLock, referenceUnitIds: [...referenceUnitIds] });
  }));

  // ── Always-on MIDI history (.mid per user/date) ─────────────────────────────
  // History lives at the HOUSEHOLD level (not data/users), and accepts `guest`
  // (the dismiss-outcome identity) in addition to known roster users.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TAKE_RE = /^[0-9][0-9.\-]{1,30}$/;            // HH.MM.SS or HH.MM.SS-2
  const historyUser = (u) => u === 'guest' || knownUser(u);

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
    const dir = configService.getHouseholdPath(path.join('history', 'piano', userId, date));
    ensureDir(dir);
    const buf = encodeMidiFile(events);
    const file = path.join(dir, `${takeId}.mid`);
    writeBinary(file, buf);                            // overwrite — idempotent
    logger.info?.('piano.history.write', { userId, date, takeId, events: events.length, bytes: buf.length });
    res.json({ ok: true, bytes: buf.length, path: file });
  }));

  // ── Effect audit (autonomous reverb/chorus audibility test) ────────────────
  // The harness page POSTs each recorded clip as raw audio/webm, then POSTs a
  // manifest. Both land under media/logs/piano/effect-audit/<runId>/ (survives
  // redeploys, like the per-session JSONL logs).
  const SAFE_SEG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/; // no slashes, no leading dot/dash
  const auditDir = (runId) => path.join(configService.getMediaDir(), 'logs', 'piano', 'effect-audit', runId);
  const rawAudio = express.raw({ type: ['audio/webm', 'application/octet-stream'], limit: '25mb' });

  router.post('/effect-audit/:runId/clip/:label', rawAudio, (req, res) => {
    const { runId, label } = req.params;
    if (!SAFE_SEG.test(runId) || !SAFE_SEG.test(label)) {
      return res.status(400).json({ error: 'Invalid runId/label' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Empty audio body' });
    }
    const dir = auditDir(runId);
    ensureDir(dir);
    const file = path.join(dir, `${label}.webm`);
    writeBinary(file, req.body);
    logger.info?.('piano.effect-audit.clip', { runId, label, bytes: req.body.length });
    res.status(201).json({ ok: true, bytes: req.body.length, path: file });
  });

  router.post('/effect-audit/:runId/manifest', (req, res) => {
    const { runId } = req.params;
    if (!SAFE_SEG.test(runId)) return res.status(400).json({ error: 'Invalid runId' });
    const manifest = req.body;
    if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.clips)) {
      return res.status(400).json({ error: 'manifest.clips (array) required' });
    }
    const dir = auditDir(runId);
    ensureDir(dir);
    const file = path.join(dir, 'manifest.json');
    writeBinary(file, Buffer.from(JSON.stringify(manifest, null, 2)));
    logger.info?.('piano.effect-audit.manifest', { runId, clips: manifest.clips.length });
    res.status(201).json({ ok: true, clips: manifest.clips.length, path: file });
  });

  return router;
}

export default createPianoRouter;
