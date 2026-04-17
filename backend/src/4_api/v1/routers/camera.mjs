// backend/src/4_api/v1/routers/camera.mjs
import express from 'express';
import fs from 'fs';
import { asyncHandler } from '#system/http/middleware/index.mjs';

export function createCameraRouter({ cameraService, broadcastEvent, logger = console }) {
  const router = express.Router();

  // GET / — list cameras
  router.get('/', (req, res) => {
    const cameras = cameraService.listCameras();
    res.json({ cameras });
  });

  // GET /:id/snap — proxy JPEG snapshot
  router.get('/:id/snap', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }

    const opts = {};
    if (req.query.width) opts.width = parseInt(req.query.width);
    if (req.query.height) opts.height = parseInt(req.query.height);
    const snapshot = await cameraService.getSnapshot(id, opts);
    if (!snapshot) {
      return res.status(502).json({ error: 'Camera unreachable', cameraId: id });
    }

    res.set({
      'Content-Type': snapshot.contentType,
      'Content-Length': snapshot.buffer.length,
      'Cache-Control': 'no-cache',
    });
    res.send(snapshot.buffer);
  }));

  // GET /:id/live/stream.m3u8 — HLS playlist (starts ffmpeg if needed)
  router.get('/:id/live/stream.m3u8', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }

    try {
      const dir = await cameraService.startStream(id);
      const playlist = await fs.promises.readFile(`${dir}/stream.m3u8`, 'utf8');
      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache',
      });
      res.send(playlist);
    } catch (err) {
      logger.error?.('camera.live.playlistError', { cameraId: id, error: err.message });
      if (!res.headersSent) {
        res.status(502).json({ error: 'Failed to start stream', cameraId: id, details: err.message });
      }
    }
  }));

  // GET /:id/live/:segment — serve HLS .ts segment
  router.get('/:id/live/:segment', asyncHandler(async (req, res) => {
    const { id, segment } = req.params;

    if (!cameraService.isStreamActive(id)) {
      return res.status(404).json({ error: 'Stream not active', cameraId: id });
    }

    if (!segment.endsWith('.ts') || segment.includes('..') || segment.includes('/')) {
      return res.status(400).json({ error: 'Invalid segment name' });
    }

    cameraService.touchStream(id);

    const dir = await cameraService.startStream(id);
    const segmentPath = `${dir}/${segment}`;

    try {
      await fs.promises.access(segmentPath);
    } catch {
      return res.status(404).json({ error: 'Segment not found', segment });
    }

    const segmentData = await fs.promises.readFile(segmentPath);
    res.set({
      'Content-Type': 'video/mp2t',
      'Content-Length': segmentData.length,
      'Cache-Control': 'public, max-age=60',
    });
    res.send(segmentData);
  }));

  // DELETE /:id/live — stop a live stream
  router.delete('/:id/live', (req, res) => {
    const { id } = req.params;
    cameraService.stopStream(id);
    res.json({ stopped: true, cameraId: id });
  });

  /** GET /api/v1/camera/:id/state — AI detection + motion state */
  router.get('/:id/state', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }
    const state = await cameraService.getDetectionState(id);
    res.json(state);
  }));

  /** GET /api/v1/camera/:id/controls — list available controls */
  router.get('/:id/controls', asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }
    const controls = await cameraService.listControls(id);
    res.json({ controls });
  }));

  /** POST /api/v1/camera/:id/controls/:controlId — execute a control */
  router.post('/:id/controls/:controlId', asyncHandler(async (req, res) => {
    const { id, controlId } = req.params;
    const { action } = req.body || {};
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }
    if (!action || !['on', 'off', 'trigger'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be on, off, or trigger.' });
    }
    const result = await cameraService.executeControl(id, controlId, action);
    res.json(result);
  }));

  // POST /:id/event — webhook for external events (e.g., HA doorbell ring)
  router.post('/:id/event', (req, res) => {
    const { id } = req.params;
    if (!cameraService.hasCamera(id)) {
      return res.status(404).json({ error: 'Camera not found', cameraId: id });
    }

    const { event } = req.body || {};
    if (!event) {
      return res.status(400).json({ error: 'Missing event field' });
    }

    const topic = req.body.topic || 'doorbell';
    logger.info?.('camera.event', { cameraId: id, event, topic });
    broadcastEvent({ topic, event, cameraId: id });
    res.json({ broadcast: true, topic, event, cameraId: id });
  });

  return router;
}

export default createCameraRouter;
