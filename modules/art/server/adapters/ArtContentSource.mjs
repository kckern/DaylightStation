/**
 * ArtContentSource — a thin IContentSource so `art:<preset>` ids resolve through
 * the content registry for ONE purpose: menu-card thumbnails via /display.
 *
 * Art presets are screensaver scenes, not playable/listable content — they are
 * mounted by the frontend through the dedicated /api/v1/art/preset/:key route,
 * not through the generic content pipeline. So this source implements only the
 * thumbnail path and returns empty/null for the list/playable interface (which
 * `validateAdapter` requires but the display path never calls for art).
 *
 * getThumbnailUrl delegates to the ArtAdapter, which maps the preset to its
 * collection and returns a deterministic representative image.
 */
export function createArtContentSource({ artAdapter, logger = console } = {}) {
  const stripPrefix = (id) => String(id).replace(/^art:/, '');

  // The adapter returns the canonical `/media/img/...` path used everywhere in
  // the art domain; the browser-facing served route is `/api/v1/static/img/...`
  // (the same rewrite DaylightMediaPath applies). The /display router redirects
  // to whatever we return, so hand back the served path.
  const toServedPath = (img) =>
    (img && img.startsWith('/media/img/')) ? img.replace('/media/img/', '/api/v1/static/img/') : img;

  return {
    source: 'art',
    prefixes: [{ prefix: 'art' }],

    // Representative image for a preset (or raw collection key).
    async getThumbnailUrl(localId) {
      try {
        return toServedPath(await artAdapter.getThumbnailUrl(localId));
      } catch (err) {
        logger.warn?.('art.content.thumbnail_failed', { localId, error: err.message });
        return null;
      }
    },

    async getItem(compoundId) {
      const preset = stripPrefix(compoundId);
      const thumbnail = await this.getThumbnailUrl(preset);
      return thumbnail ? { id: compoundId, title: preset, thumbnail } : null;
    },

    // Art presets are not generic list/playable content (see header).
    async getList() { return []; },
    async resolvePlayables() { return []; },
    async resolveSiblings() { return null; },
  };
}

export default createArtContentSource;
