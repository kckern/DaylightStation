import { sendInternalError } from '#api/utils/internalError.mjs';
import express from 'express';

/** Thin HTTP adapter for printable catalog generation. */
export function createCatalogRouter({ generateCatalog, contentExpression, logger = console } = {}) {
  if (typeof generateCatalog !== 'function' || !contentExpression?.fromQuery) {
    throw new Error('createCatalogRouter requires generateCatalog and contentExpression');
  }
  const router = express.Router();
  router.get('/:source/:id', async (req, res) => {
    try {
      const result = await generateCatalog({
        source: req.params.source,
        id: req.params.id,
        expression: contentExpression.fromQuery(req.query),
      });
      if (result.kind === 'empty') return res.status(404).json({ error: 'No items in list' });
      if (result.kind === 'render_unavailable') return sendInternalError(res, { error: 'All QR code fetches failed' });
      const { title, pdf } = result.value;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${title}.pdf"`);
      return res.send(pdf);
    } catch (err) {
      if (err?.code === 'catalog_list_source_rejected' && Number.isInteger(err.status)) {
        return res.status(err.status).json({ error: 'Failed to fetch list' });
      }
      logger.error?.('catalog.render.failed', { error: err.message });
      return sendInternalError(res, { error: 'Catalog generation failed' });
    }
  });
  return router;
}
