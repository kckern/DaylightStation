import express from 'express';
import path from 'path';
import {
  loadYaml,
  saveYaml,
  listYamlFiles,
  deleteYaml,
} from '#system/utils/FileIO.mjs';
import { shortId } from '#domains/core/utils/id.mjs';

/**
 * Piano kiosk API — studio take persistence.
 *
 * A household can have multiple piano kiosks (one per instrument), so takes are
 * scoped by pianoId: data/household[-{id}]/apps/piano/studio/{pianoId}/{id}.yml.
 * No MIDI happens here — the browser owns Web-MIDI; this is plain CRUD.
 *
 * Routes (mounted at /api/v1/piano):
 *   GET    /:pianoId/studio        → { takes: [{id,title,created,durationMs,eventCount}] }
 *   GET    /:pianoId/studio/:id    → { id, title, created, durationMs, events }
 *   POST   /:pianoId/studio        → { id, ... }  (body: { title, durationMs, events })
 *   DELETE /:pianoId/studio/:id    → { ok, id }
 */
export function createPianoRouter({ configService, logger = console }) {
  const router = express.Router();
  const studioRoot = configService.getHouseholdPath('apps/piano/studio');

  // Reject ids/segments that could escape their directory.
  const safeSegment = (s) => typeof s === 'string' && s.length > 0 && !s.includes('/') && !s.includes('\\') && !s.includes('..');

  // Per-piano studio dir, with containment check.
  const pianoDir = (pianoId) => {
    if (!safeSegment(pianoId)) return null;
    const dir = path.join(studioRoot, pianoId);
    return dir.startsWith(studioRoot + path.sep) ? dir : null;
  };

  router.get('/:pianoId/studio', (req, res) => {
    try {
      const dir = pianoDir(req.params.pianoId);
      if (!dir) return res.status(400).json({ error: 'Invalid piano id' });
      const ids = listYamlFiles(dir); // [] if dir missing
      const takes = ids.map((id) => {
        const data = loadYaml(path.join(dir, id)) || {};
        return {
          id,
          title: data.title || id,
          created: data.created || null,
          durationMs: data.durationMs || 0,
          eventCount: Array.isArray(data.events) ? data.events.length : 0,
        };
      });
      res.json({ takes });
    } catch (err) {
      logger.error?.('piano.studio.list.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:pianoId/studio/:id', (req, res) => {
    try {
      const dir = pianoDir(req.params.pianoId);
      if (!dir || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
      const data = loadYaml(path.join(dir, req.params.id));
      if (!data) return res.status(404).json({ error: 'Take not found' });
      res.json(data);
    } catch (err) {
      logger.error?.('piano.studio.read.error', { id: req.params.id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:pianoId/studio', (req, res) => {
    try {
      const dir = pianoDir(req.params.pianoId);
      if (!dir) return res.status(400).json({ error: 'Invalid piano id' });
      const { title, durationMs, events } = req.body || {};
      if (!Array.isArray(events) || events.length === 0) {
        return res.status(400).json({ error: 'events (non-empty array) required' });
      }
      const id = shortId();
      const data = {
        id,
        pianoId: req.params.pianoId,
        title: title || `Take ${id}`,
        created: new Date().toISOString(),
        durationMs: Number(durationMs) || 0,
        events,
      };
      saveYaml(path.join(dir, id), data);
      logger.info?.('piano.studio.save', { pianoId: req.params.pianoId, id, events: events.length });
      res.status(201).json(data);
    } catch (err) {
      logger.error?.('piano.studio.create.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:pianoId/studio/:id', (req, res) => {
    try {
      const dir = pianoDir(req.params.pianoId);
      if (!dir || !safeSegment(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
      const deleted = deleteYaml(path.join(dir, req.params.id));
      if (!deleted) return res.status(404).json({ error: 'Take not found' });
      res.json({ ok: true, id: req.params.id });
    } catch (err) {
      logger.error?.('piano.studio.delete.error', { id: req.params.id, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export default createPianoRouter;
