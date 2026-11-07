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
  //   POST /:ratingKey/scenes/:sceneId/card -> { card }   (redraft one)
  //   PUT  /:ratingKey/cues/:cueId {effect, disabled, card, by} -> { ruling }
  //   POST /:ratingKey/cues/:cueId/card -> { cardDraft }   (LLM draft, stored unapproved)
  //   PUT  /:ratingKey/scenes/:sceneId {effect, disabled, card, by} -> { ruling }
  if (contentFilterScenes) {
    const rk = (req) => String(req.params.ratingKey).replace(/[^0-9]/g, '');
    // A scene/cue id is used as-is or refused: silently stripping `va123#0` to `va1230` would rule the wrong item.
    const cleanId = (raw) => { const v = String(raw); return v === v.replace(/[^a-z0-9_-]/gi, '') ? v : null; };
    const profileOf = (req) => String(req.query.profile || 'family').replace(/[^a-z0-9_-]/gi, '');

    // Settings: four plain choices, for this film (override.profilePatch) or everywhere (the profile).
    //   PUT    /:ratingKey/settings {settings}       -> { profilePatch }
    //   DELETE /:ratingKey/settings                  -> { cleared }
    //   PUT    /profiles/:name/settings {settings}   -> { profile }
    // /profiles/... has two segments before /settings, so it never collides with /:ratingKey routes.
    router.put('/profiles/:name/settings', asyncHandler(async (req, res) => {
      const profileName = String(req.params.name).replace(/[^a-z0-9_-]/gi, '').toLowerCase();
      if (!profileName) return res.status(400).json({ error: 'invalid profile' });
      let out;
      try {
        out = await contentFilterScenes.setProfileSettings({ profileName, settings: req.body?.settings });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      if (!out) return res.status(404).json({ error: 'no such profile', profile: profileName });
      res.json(out);
    }));
    router.put('/:ratingKey/settings', asyncHandler(async (req, res) => {
      if (!rk(req)) return res.status(400).json({ error: 'invalid ratingKey' });
      try {
        res.json(await contentFilterScenes.setTitleSettings({ ratingKey: rk(req), settings: req.body?.settings, profileName: profileOf(req) }));
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    }));
    router.delete('/:ratingKey/settings', asyncHandler(async (req, res) => {
      if (!rk(req)) return res.status(400).json({ error: 'invalid ratingKey' });
      res.json(await contentFilterScenes.clearTitleSettings({ ratingKey: rk(req) }));
    }));

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
      const sceneId = cleanId(req.params.sceneId);
      if (sceneId === null) return res.status(400).json({ error: 'invalid id', id: req.params.sceneId });
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
    router.post('/:ratingKey/scenes/:sceneId/card', asyncHandler(async (req, res) => {
      const sceneId = cleanId(req.params.sceneId);
      if (sceneId === null) return res.status(400).json({ error: 'invalid id', id: req.params.sceneId });
      let out;
      try {
        out = await contentFilterScenes.draftCard({ ratingKey: rk(req), sceneId, profileName: profileOf(req) });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      if (!out) return res.status(404).json({ error: 'no such scene', sceneId });
      res.json(out);
    }));

    router.put('/:ratingKey/cues/:cueId', asyncHandler(async (req, res) => {
      const cueId = cleanId(req.params.cueId);
      if (cueId === null) return res.status(400).json({ error: 'invalid id', id: req.params.cueId });
      const { effect, disabled, card, by } = req.body || {};
      let ruling;
      try {
        ruling = await contentFilterScenes.ruleCue({ ratingKey: rk(req), cueId, effect, disabled, card, by });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      if (!ruling) return res.status(404).json({ error: 'no such cue', cueId });
      res.json({ ruling });
    }));

    router.post('/:ratingKey/cues/:cueId/card', asyncHandler(async (req, res) => {
      const cueId = cleanId(req.params.cueId);
      if (cueId === null) return res.status(400).json({ error: 'invalid id', id: req.params.cueId });
      let out;
      try {
        out = await contentFilterScenes.draftCueCard({ ratingKey: rk(req), cueId, profileName: profileOf(req) });
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
      if (!out) return res.status(404).json({ error: 'no such cue', cueId });
      res.json(out);
    }));
  }

  return router;
}

export default createContentFilterRouter;
