import express from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { createArtSource } from '../../../../1_adapters/content/art/sources/artSource.mjs';
import { mergeWorkMetadata, filterWorks } from '../../../../1_adapters/content/art/workMetadata.mjs';

/**
 * Admin Art router — curate the classic file-based art library.
 *   GET  /works         list works (filter: source, tag, hidden, flagged, q, page, pageSize)
 *   PATCH /works/*       merge a metadata patch into one work's metadata.yaml
 *
 * @param {Object} config
 * @param {string} config.mediaPath - base media dir; images live under <mediaPath>/img/art/<scope>/
 * @param {Object} [config.logger=console]
 */
export function createAdminArtRouter({ mediaPath, logger = console }) {
  const router = express.Router();
  const imgBasePath = path.join(mediaPath, 'img');
  const artSource = createArtSource({ imgBasePath, logger });

  const scopeDirFor = (source) => path.join(imgBasePath, source ? `art/${source}` : 'art/classic');

  router.get('/works', async (req, res) => {
    try {
      const { source, tag, hidden, flagged, q } = req.query;
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 60));
      const all = await artSource.listWorks({ folder: source && source !== 'classic' ? source : undefined });
      const filtered = filterWorks(all, {
        tag: tag || undefined, q: q || undefined,
        hidden: hidden === 'true', flagged: flagged === 'true',
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
    const rawId = req.params[0] || '';
    const source = req.body?.source;
    const scopeDir = scopeDirFor(source);
    const workDir = path.resolve(scopeDir, rawId);
    // Traversal guard: the resolved work dir must stay inside the scope.
    if (!workDir.startsWith(path.resolve(scopeDir) + path.sep)) {
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
