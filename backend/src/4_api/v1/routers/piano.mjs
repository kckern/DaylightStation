import express from 'express';
import path from 'path';
import {
  loadYaml,
  saveYaml,
  listYamlFiles,
  deleteYaml,
} from '#system/utils/FileIO.mjs';
import { shortId } from '#domains/core/utils/id.mjs';
import { userService } from '#system/config/UserService.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';

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
export function createPianoRouter({ configService, fitnessPlayableService = null, logger = console }) {
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
  router.get('/courses/:courseId/playable', asyncHandler(async (req, res) => {
    if (!fitnessPlayableService) {
      return res.status(503).json({ error: 'Piano course service not configured' });
    }

    const { courseId } = req.params;
    const { userId } = req.query;

    if (userId && !knownUser(userId)) {
      return res.status(400).json({ error: 'Invalid user' });
    }

    const playable = await fitnessPlayableService.getPlayableEpisodes(courseId);

    const pianoConfig = configService.getHouseholdAppConfig(null, 'piano') || {};

    if (userId) {
      const dir = userPianoDir(userId);
      const userProgress = loadYaml(path.join(dir, 'video-progress')) || {};
      const threshold = pianoConfig.videos?.completion_threshold_percent ?? 90;

      playable.items = playable.items.map((item) => {
        const rawId = String(item.plex || item.id).replace(/^plex:/, '');
        const key = `plex:${rawId}`;
        const up = userProgress[key] || {};
        const userWatched = !!(up.completedAt) ||
          ((up.percent ?? 0) >= threshold && (up.engagementCount ?? 0) > 0);
        return {
          ...item,
          userPercent: up.percent ?? null,
          userPlayhead: up.playhead ?? null,
          userWatched,
          userEngaged: (up.engagementCount ?? 0) > 0,
          userCompletedAt: up.completedAt || null,
        };
      });
    }

    const sequentialLabels = new Set(
      (pianoConfig.videos?.sequential_labels || []).map((l) => l.toLowerCase())
    );
    const isSequential = Array.isArray(playable.info?.labels) &&
      playable.info.labels.some((l) => sequentialLabels.has(String(l).toLowerCase()));

    logger.info?.('piano.courses.playable', { courseId, userId: userId || null, isSequential });
    res.json({ ...playable, isSequential });
  }));

  // ── User video progress log ──────────────────────────────────────────────────
  router.post('/users/:userId/video-log', asyncHandler(async (req, res) => {
    const dir = userPianoDir(req.params.userId);
    if (!dir) return res.status(400).json({ error: 'Invalid user' });

    const { plexId, percent, seconds, duration, engaged } = req.body || {};
    if (!plexId || percent === undefined) {
      return res.status(400).json({ error: 'Missing required fields: plexId, percent' });
    }

    const pianoConfig = configService.getHouseholdAppConfig(null, 'piano') || {};
    const threshold = pianoConfig.videos?.completion_threshold_percent ?? 90;

    const rawId = String(plexId).replace(/^plex:/, '');
    const key = `plex:${rawId}`;

    const progress = loadYaml(path.join(dir, 'video-progress')) || {};
    const existing = progress[key] || {};

    const newEngagementCount = (existing.engagementCount || 0) + (engaged ? 1 : 0);
    const normalizedPercent = Math.round(parseFloat(percent) || 0);
    const completedAt = existing.completedAt ||
      (normalizedPercent >= threshold && newEngagementCount > 0
        ? new Date().toISOString()
        : null);

    progress[key] = {
      ...existing,
      playhead: Math.round(parseFloat(seconds) || 0),
      percent: normalizedPercent,
      duration: Math.round(parseFloat(duration) || 0),
      lastPlayed: new Date().toISOString(),
      engagementCount: newEngagementCount,
      completedAt,
    };

    saveYaml(path.join(dir, 'video-progress'), progress);
    logger.info?.('piano.video-log.updated', {
      userId: req.params.userId,
      plexId: key,
      percent: normalizedPercent,
      engaged: !!engaged,
      completed: !!completedAt,
    });
    res.json(progress[key]);
  }));

  return router;
}

export default createPianoRouter;
