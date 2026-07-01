import express from 'express';
import path from 'path';
import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';

/**
 * Content-filter API (mounted at /api/v1/content-filter).
 *
 * Serves the 3-layer cascade for a title so the Player's useContentFilter hook
 * can apply skip/mute/blur/etc. in real time:
 *   GET /:ratingKey?profile=family
 *     -> { edl, profile, override }
 * from data/household/shared/content-filter/{edl,profiles,overrides}/.
 *
 * ratingKey is the Plex rating key (contentId `plex:<ratingKey>`); it is
 * digit-sanitized to prevent path traversal.
 */
export function createContentFilterRouter({ dataDir, logger = console } = {}) {
  const router = express.Router();
  const root = path.join(dataDir, 'household', 'shared', 'content-filter');

  const readYaml = (p) => {
    try { return existsSync(p) ? (yaml.load(readFileSync(p, 'utf8')) || null) : null; }
    catch (e) { logger.warn?.('content-filter.read.error', { path: p, error: e.message }); return null; }
  };

  router.get('/:ratingKey', (req, res) => {
    const ratingKey = String(req.params.ratingKey).replace(/[^0-9]/g, '');
    if (!ratingKey) return res.status(400).json({ error: 'invalid ratingKey' });

    const edl = readYaml(path.join(root, 'edl', `${ratingKey}.edl.yml`));
    if (!edl) return res.status(404).json({ error: 'no filter data', ratingKey });

    const profileName = String(req.query.profile || 'family').replace(/[^a-z0-9_-]/gi, '');
    const profile = readYaml(path.join(root, 'profiles', `${profileName}.yml`));
    const override = readYaml(path.join(root, 'overrides', `${ratingKey}.yml`));

    // info (not debug) so the endpoint hit is visible in prod logs — confirms the
    // client fetched, and whether an override (sync/snap/gap-fills) was served.
    logger.info?.('content-filter.serve', {
      ratingKey, profile: profileName, cues: edl.cues?.length || 0,
      hasOverride: !!override, addCues: override?.addCues?.length || 0,
      cueOverrides: Object.keys(override?.cueOverrides || {}).length,
    });
    res.json({ edl, profile, override });
  });

  return router;
}

export default createContentFilterRouter;
