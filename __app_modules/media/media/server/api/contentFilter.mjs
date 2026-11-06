import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Content-filter API (mounted at /api/v1/content-filter).
 *
 * Serves the 3-layer cascade for a title so the Player's useContentFilter hook
 * can apply skip/mute/blur/etc. in real time:
 *   GET /:ratingKey?profile=family
 *     -> { edl, profile, override }
 * ratingKey is the Plex rating key (contentId `plex:<ratingKey>`); it is
 * digit-sanitized to prevent path traversal.
 */
export function createContentFilterRouter({ getContentFilter, contentFilterScenes = null, logger = console } = {}) {
  if (!getContentFilter || typeof getContentFilter.execute !== 'function') {
    throw new Error('createContentFilterRouter requires getContentFilter');
  }
  const router = express.Router();

  if (contentFilterScenes) {
    // GET / -> { titles }: every title with a refined filter (Admin index).
    router.get('/', asyncHandler(async (req, res) => {
      const profileName = String(req.query.profile || 'family').replace(/[^a-z0-9_-]/gi, '');
      res.json({ titles: await contentFilterScenes.titles({ profileName }) });
    }));
  }

  router.get('/:ratingKey', asyncHandler(async (req, res) => {
    const ratingKey = String(req.params.ratingKey).replace(/[^0-9]/g, '');
    if (!ratingKey) return res.status(400).json({ error: 'invalid ratingKey' });

    const profileName = String(req.query.profile || 'family').replace(/[^a-z0-9_-]/gi, '');
    const { edl, profile, override, certification } = await getContentFilter.execute({
      ratingKey,
      profileName,
    });
    if (!edl) return res.status(404).json({ error: 'no filter data', ratingKey });

    // info (not debug) so the endpoint hit is visible in prod logs — confirms the
    // client fetched, and whether an override (sync/snap/gap-fills) was served.
    logger.info?.('content-filter.serve', {
      ratingKey, profile: profileName, cues: edl.cues?.length || 0,
      hasOverride: !!override, addCues: override?.addCues?.length || 0,
      cueOverrides: Object.keys(override?.cueOverrides || {}).length,
    });
    res.json({ edl, profile, override, certification });
  }));

  // Scenes: the grown-up's review (Admin -> Content filter -> Scenes).
  //   GET  /:ratingKey/scenes?profile=family     -> { title, calibration, scenes }
  //   POST /:ratingKey/scenes/cards {all, force} -> { drafted, scenes }   (LLM drafts)
  //   PUT  /:ratingKey/scenes/:sceneId {effect, disabled, card, by} -> { ruling }
  if (contentFilterScenes) {
    const rk = (req) => String(req.params.ratingKey).replace(/[^0-9]/g, '');
    const profileOf = (req) => String(req.query.profile || 'family').replace(/[^a-z0-9_-]/gi, '');

    router.get('/:ratingKey/scenes', asyncHandler(async (req, res) => {
      const out = await contentFilterScenes.list({ ratingKey: rk(req), profileName: profileOf(req) });
      if (!out) return res.status(404).json({ error: 'no refined filter', ratingKey: rk(req) });
      res.json(out);
    }));

    router.post('/:ratingKey/scenes/cards', asyncHandler(async (req, res) => {
      const out = await contentFilterScenes.draftCards({
        ratingKey: rk(req), profileName: profileOf(req), all: !!req.body?.all, force: !!req.body?.force,
      });
      if (!out) return res.status(404).json({ error: 'no refined filter', ratingKey: rk(req) });
      res.json(out);
    }));

    router.put('/:ratingKey/scenes/:sceneId', asyncHandler(async (req, res) => {
      const sceneId = String(req.params.sceneId).replace(/[^a-z0-9_-]/gi, '');
      const { effect, disabled, card, by } = req.body || {};
      let ruling;
      try {
        ruling = await contentFilterScenes.rule({ ratingKey: rk(req), sceneId, effect, disabled, card, by });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      if (!ruling) return res.status(404).json({ error: 'no such scene', sceneId });
      res.json({ ruling });
    }));
  }

  return router;
}

export default createContentFilterRouter;
