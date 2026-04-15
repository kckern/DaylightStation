// backend/src/4_api/v1/routers/camera.mjs
import express from 'express';
import fs from 'fs';
import { asyncHandler } from '#system/http/middleware/index.mjs';

export function createCameraRouter({ cameraService, logger = console }) {
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

    const snapshot = await cameraService.getSnapshot(id);
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

  return router;
}

export default createCameraRouter;
