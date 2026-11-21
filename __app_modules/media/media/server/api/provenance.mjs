import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';
import { sendInternalError } from '#api/utils/internalError.mjs';

/**
 * Provenance API (mounted at /api/v1/provenance): which streaming service a
 * title is shown as coming from, for the Player's provenance bumper.
 *
 *   GET /:ratingKey      -> { provenance: { provider, name, tier, offerType, checkedAt, logo } | null }
 *   GET /logo/:provider  -> the provider's logo; `?variant=white` prefers the
 *                           white logo for dark screens (falls back to the base logo)
 *
 * Reference: __docs/reference/media/provenance.md
 */
export function createProvenanceRouter({ getTitleProvenance, logos, logger = console } = {}) {
  if (!getTitleProvenance || typeof getTitleProvenance.execute !== 'function') {
    throw new Error('createProvenanceRouter requires getTitleProvenance');
  }
  if (!logos || typeof logos.open !== 'function') throw new Error('createProvenanceRouter requires logos');
  const router = express.Router();

  router.get('/logo/:provider', (req, res) => {
    const provider = String(req.params.provider);
    if (!/^[a-z0-9-]{1,40}$/.test(provider)) return res.status(400).json({ error: 'bad provider' });
    const logo = logos.open(provider, { white: req.query.variant === 'white' });
    if (!logo) return res.status(404).json({ error: 'no logo' });
    res.set('Content-Type', logo.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    logo.stream.on('error', (error) => {
      logger.warn?.('provenance.logo.read-failed', { provider, error: error?.message });
      if (!res.headersSent) sendInternalError(res, { error: 'logo read failed' }); else res.destroy();
    });
    logo.stream.pipe(res);
  });

  router.get('/:ratingKey', asyncHandler(async (req, res) => {
    const ratingKey = String(req.params.ratingKey).replace(/^plex:/, '');
    if (!/^\d+$/.test(ratingKey)) return res.status(400).json({ error: 'bad ratingKey' });
    const found = await getTitleProvenance.execute({ ratingKey });
    res.set('Cache-Control', 'no-store');
    res.json({
      provenance: found ? { ...found, logo: `/api/v1/provenance/logo/${found.provider}` } : null,
    });
  }));

  return router;
}
