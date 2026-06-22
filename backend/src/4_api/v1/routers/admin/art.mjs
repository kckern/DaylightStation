import express from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { createArtSource } from '../../../../1_adapters/content/art/sources/artSource.mjs';
import { mergeWorkMetadata, filterWorks } from '../../../../1_adapters/content/art/workMetadata.mjs';
import { matchesCollection } from '../../../../1_adapters/content/art/collections.mjs';
import { loadArtCollections } from '../../../../1_adapters/content/art/artmodeConfig.mjs';

/**
 * Admin Art router — curate the classic file-based art library.
 *   GET  /works         list works (filter: source, tag, hidden, flagged, q, page, pageSize)
 *   PATCH /works/*       merge a metadata patch into one work's metadata.yaml
 *
 * The `tag` filter doubles as a collection filter: if it names a known collection
 * (from art.yml), works are matched by rule OR hand-tag (so rule-based members are
 * curatable, not just hand-tagged ones); otherwise it matches the raw hand-tag.
 *
 * @param {Object} config
 * @param {string} config.mediaPath - base media dir; images live under <mediaPath>/img/art/<scope>/
 * @param {string} [config.dataPath] - base data dir; collection defs come from <dataPath>/household/config/art.yml
 * @param {Function} [config.getCollections] - test seam: async () => collectionsMap (overrides dataPath load)
 * @param {Object} [config.logger=console]
 */
export function createAdminArtRouter({ mediaPath, dataPath, getCollections, logger = console }) {
  const router = express.Router();
  const imgBasePath = path.join(mediaPath, 'img');
  const artSource = createArtSource({ imgBasePath, logger });

  // Collection defs (art.yml) drive the collection-aware tag filter. Loaded once
  // and cached; falls back to {} so an unknown/absent art.yml just means the tag
  // filter behaves as a plain hand-tag match.
  let _collections = null;
  const loadCollections = getCollections || (async () => {
    if (_collections) return _collections;
    try {
      _collections = dataPath ? await loadArtCollections(dataPath, logger) : {};
    } catch (err) {
      logger.warn?.('admin.art.collections.load_failed', { error: err.message });
      _collections = {};
    }
    return _collections;
  });

  // The art tree is the hard security boundary. `source` (a scope name) comes from
  // the client, so resolve it and reject anything that escapes <imgBasePath>/art —
  // otherwise a `source` of `../../etc` would relocate the whole scope before the
  // per-work id guard below ever runs.
  const artRoot = path.resolve(imgBasePath, 'art');
  const safeScopeDir = (source) => {
    const dir = path.resolve(imgBasePath, source ? `art/${source}` : 'art/classic');
    return (dir === artRoot || dir.startsWith(artRoot + path.sep)) ? dir : null;
  };

  router.get('/works', async (req, res) => {
    try {
      const { source, tag, hidden, flagged, q } = req.query;
      if (!safeScopeDir(source)) return res.status(400).json({ error: 'Invalid source' });
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(2000, Math.max(1, parseInt(req.query.pageSize, 10) || 60));
      let all = await artSource.listWorks({ folder: source && source !== 'classic' ? source : undefined });
      // Collection-aware tag filter: a known collection name matches by rule OR tag
      // (hidden/flagged still listed, so they can be curated); any other tag is a
      // plain hand-tag match. q/hidden/flagged narrow further via filterWorks.
      if (tag) {
        const cols = await loadCollections();
        all = Object.prototype.hasOwnProperty.call(cols, tag)
          ? all.filter((w) => matchesCollection(tag, cols[tag] || {}, { folder: w.id, meta: w.meta }))
          : all.filter((w) => Array.isArray(w.meta.tags) && w.meta.tags.includes(tag));
      }
      const filtered = filterWorks(all, {
        q: q || undefined, hidden: hidden === 'true', flagged: flagged === 'true',
      });
      const start = (page - 1) * pageSize;
      res.json({ total: filtered.length, page, pageSize, works: filtered.slice(start, start + pageSize) });
    } catch (err) {
      logger.error?.('admin.art.list.failed', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /works/<folder> — folder may contain slashes (sectioned scopes), so use a wildcard.
  // The backend runs Express 4 (backend/package.json pins ^4.18.2), so use the Express 4
  // wildcard form `/works/*` with `req.params[0]`. Express 5's `*splat` form does not
  // apply here; the root-level express@5 is only used by test files, not imported modules.
  router.patch('/works/*', async (req, res) => {
    const scopeDir = safeScopeDir(req.body?.source);
    if (!scopeDir) return res.status(400).json({ error: 'Invalid source' });
    const rawId = req.params[0] || '';
    const workDir = path.resolve(scopeDir, rawId);
    // Per-work traversal guard: the resolved work dir must stay inside the (already
    // art-root-bounded) scope, and must name an actual work (not the scope itself).
    if (workDir === scopeDir || !workDir.startsWith(scopeDir + path.sep)) {
      return res.status(400).json({ error: 'Invalid work id' });
    }
    const file = path.join(workDir, 'metadata.yaml');
    try {
      const patch = { ...req.body }; delete patch.source;
      const raw = await fs.readFile(file, 'utf-8');
      const merged = mergeWorkMetadata(raw, patch);   // throws on invalid anchor
      await fs.writeFile(file, merged, 'utf-8');
      logger.info?.('admin.art.patched', { id: rawId, fields: Object.keys(patch) });
      res.json({ ok: true, id: rawId, meta: yaml.load(merged) });
    } catch (err) {
      if (/anchor/i.test(err.message)) return res.status(400).json({ error: err.message });
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Work not found' });
      logger.error?.('admin.art.patch.failed', { id: rawId, error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

export default createAdminArtRouter;
