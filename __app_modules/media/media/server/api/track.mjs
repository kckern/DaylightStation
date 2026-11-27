import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { splatPath } from '#api/utils/wildcard.mjs';

/** The `samples` query: 120 by default, 16..400. */
export function clampSamples(raw, { fallback = 120, min = 16, max = 400 } = {}) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * /api/v1/track — what a player shows beside the transport for one track.
 *
 * GET /levels/:source/<id>?samples=N
 *   200 { samples: number[0..1], quality: {codec, bitrate (kbps), sampleRate (Hz), bitDepth} , source }
 *       samples is [] when the track has no loudness analysis; quality fields
 *       that are unknown are left out (quality is omitted when nothing is known)
 *   204 nothing to show (a source without levels, or neither levels nor quality)
 *   404 unknown item
 * GET /lyrics/:source/<id>
 *   200 { synced, lines: [{ ms: number|null, text }], provider: 'plex'|'lrclib' }
 *   204 no lyrics anywhere (or the lookup elsewhere failed: it is tried again next time)
 *   404 unknown item
 *
 * GET /chapters/:source/<id>
 *   200 { chapters: [{ startMs, endMs, title }], durationMs, provider: 'plex'|'audiobookshelf' }
 *   204 no chapters (none, no safe match, or the lookup failed this time)
 *   404 unknown item
 *
 * See __docs/reference/media/media-app-technical.md (Track extras).
 */
export function createTrackRouter({ trackExtras, trackChapters = null, logger = console }) {
  const router = express.Router();

  router.get('/levels/:source{/*splat}', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const localId = splatPath(req);
    if (!localId) return res.status(400).json({ error: 'track id required' });
    const samples = clampSamples(req.query.samples);
    const out = await trackExtras.levels(source, localId, samples);
    if (out.kind === 'not_found') return res.status(404).json({ error: 'Item not found', source, localId });
    if (out.kind === 'none') return res.status(204).end();
    res.set('Cache-Control', 'private, max-age=3600');
    return res.json({ samples: out.samples, ...(out.quality && { quality: out.quality }), source });
  }));

  router.get('/lyrics/:source{/*splat}', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const localId = splatPath(req);
    if (!localId) return res.status(400).json({ error: 'track id required' });
    const out = await trackExtras.lyrics(source, localId);
    if (out.kind === 'not_found') return res.status(404).json({ error: 'Item not found', source, localId });
    if (out.kind === 'none') return res.status(204).end();
    res.set('Cache-Control', 'private, max-age=3600');
    return res.json({ synced: out.synced, lines: out.lines, provider: out.provider });
  }));

  router.get('/chapters/:source{/*splat}', asyncHandler(async (req, res) => {
    const { source } = req.params;
    const localId = splatPath(req);
    if (!localId) return res.status(400).json({ error: 'track id required' });
    if (!trackChapters) return res.status(204).end();
    const out = await trackChapters.chapters(source, localId);
    if (out.kind === 'not_found') return res.status(404).json({ error: 'Item not found', source, localId });
    if (out.kind === 'none') return res.status(204).end();
    res.set('Cache-Control', 'private, max-age=3600');
    return res.json({ chapters: out.chapters, durationMs: out.durationMs, provider: out.provider });
  }));

  logger.debug?.('media.track-router.created');
  return router;
}

export default createTrackRouter;
