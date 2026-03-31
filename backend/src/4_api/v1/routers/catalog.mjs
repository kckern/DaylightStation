/**
 * Catalog PDF Router
 *
 * Generates a printable PDF grid of QR codes for all items in a content container.
 * Reuses existing /list and /qrcode endpoints via internal HTTP calls.
 *
 * GET /api/v1/catalog/:source/:id?screen=...&options=...
 *
 * @module api/v1/routers/catalog
 */

import express from 'express';
import sharp from 'sharp';

/**
 * @param {Object} config
 * @param {Object} config.renderer - CatalogRenderer with render()
 * @param {number} config.port - Server port for internal HTTP calls
 * @param {Object} [config.logger]
 */
export function createCatalogRouter(config) {
  const { renderer, port, logger = console } = config;
  const router = express.Router();

  const baseUrl = `http://localhost:${port}`;

  /**
   * GET /api/v1/catalog/:source/:id
   */
  router.get('/:source/:id', async (req, res) => {
    try {
      const { source, id } = req.params;
      const { screen, options } = req.query;

      // 1. Fetch list
      const listUrl = `${baseUrl}/api/v1/list/${source}/${id}`;
      logger.info?.('catalog.list.fetch', { listUrl });
      const listRes = await fetch(listUrl);
      if (!listRes.ok) {
        return res.status(listRes.status).json({ error: 'Failed to fetch list' });
      }
      const listData = await listRes.json();
      const title = listData.title || 'Catalog';
      const items = listData.items || [];

      if (items.length === 0) {
        return res.status(404).json({ error: 'No items in list' });
      }

      // 2. Fetch QR SVGs for each item
      const pngBuffers = await Promise.all(
        items.map(async (item) => {
          try {
            const params = new URLSearchParams();
            params.set('content', item.id);
            if (screen) params.set('screen', screen);
            if (options) params.set('options', options);

            const qrUrl = `${baseUrl}/api/v1/qrcode?${params}`;
            const qrRes = await fetch(qrUrl);
            if (!qrRes.ok) return null;

            const svgText = await qrRes.text();

            // 3. Convert SVG to PNG via sharp
            const pngBuf = await sharp(Buffer.from(svgText))
              .png()
              .toBuffer();
            return pngBuf;
          } catch (err) {
            logger.warn?.('catalog.qr.failed', { itemId: item.id, error: err.message });
            return null;
          }
        })
      );

      // Filter out failed items
      const validPngs = pngBuffers.filter(Boolean);
      if (validPngs.length === 0) {
        return res.status(500).json({ error: 'All QR code conversions failed' });
      }

      // 4. Render PDF
      const pdfBytes = await renderer.render({ title, images: validPngs });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${title}.pdf"`);
      res.send(Buffer.from(pdfBytes));

    } catch (err) {
      logger.error?.('catalog.render.failed', { error: err.message });
      res.status(500).json({ error: 'Catalog generation failed' });
    }
  });

  return router;
}
