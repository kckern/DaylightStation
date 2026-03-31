/**
 * Catalog PDF Router
 *
 * Generates a printable PDF grid of QR codes for all items in a content container.
 * Reuses existing /list and /qrcode endpoints via internal HTTP calls.
 * SVGs are embedded as native PDF vector content via svg-to-pdfkit (no rasterization).
 *
 * GET /api/v1/catalog/:source/:id?screen=...&options=...
 *
 * @module api/v1/routers/catalog
 */

import express from 'express';
import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { Resvg } from '@resvg/resvg-js';
import { ContentExpression } from '#domains/content/ContentExpression.mjs';

const PAGE_WIDTH = 612;   // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 36;
const COLS = 3;
const ROWS = 5;
const TITLE_HEIGHT = 50;
const CELL_GAP = 8;

/**
 * @param {Object} config
 * @param {number} config.port - Server port for internal HTTP calls
 * @param {Object} [config.logger]
 */
export function createCatalogRouter(config) {
  const { port, logger = console } = config;
  const router = express.Router();

  const baseUrl = `http://localhost:${port}`;

  router.get('/:source/:id', async (req, res) => {
    try {
      const { source, id } = req.params;

      // Parse screen and bare-key options from query via ContentExpression
      const expr = ContentExpression.fromQuery(req.query);
      const screen = expr.screen;
      const optionStr = Object.entries(expr.options)
        .map(([k, v]) => v === true ? k : `${k}=${v}`)
        .join('+') || null;

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

      // 2. Fetch QR SVGs (in batches to avoid overwhelming thumbnail proxy)
      const CONCURRENCY = 2;
      const svgs = [];
      for (let i = 0; i < items.length; i += CONCURRENCY) {
        const batch = items.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(async (item) => {
          try {
            const params = new URLSearchParams();
            params.set('queue', item.id);
            if (screen) params.set('screen', screen);
            if (optionStr) {
              for (const opt of optionStr.split('+')) {
                const [k, v] = opt.split('=');
                params.set(k, v || '');
              }
            }

            const qrUrl = `${baseUrl}/api/v1/qrcode?${params}`;
            const qrRes = await fetch(qrUrl);
            if (!qrRes.ok) {
              logger.warn?.('catalog.qr.fetchFailed', { itemId: item.id, status: qrRes.status });
              return null;
            }
            let svgText = await qrRes.text();

            // Convert any embedded SVG images to PNG (svg-to-pdfkit can't handle SVG-in-SVG)
            svgText = convertEmbeddedSvgsToPng(svgText);

            return svgText;
          } catch (err) {
            logger.warn?.('catalog.qr.failed', { itemId: item.id, error: err.message });
            return null;
          }
        }));
        svgs.push(...results);
      }

      const validSvgs = svgs.filter(Boolean);
      if (validSvgs.length === 0) {
        return res.status(500).json({ error: 'All QR code fetches failed' });
      }

      // 3. Build PDF with native vector SVGs
      const doc = new PDFDocument({ size: 'letter', margin: 0 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));

      const contentWidth = PAGE_WIDTH - 2 * MARGIN;
      const cellWidth = (contentWidth - (COLS - 1) * CELL_GAP) / COLS;
      const itemsPerPage = COLS * ROWS;
      const totalPages = Math.ceil(validSvgs.length / itemsPerPage);

      for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
        if (pageIdx > 0) doc.addPage();
        const isFirstPage = pageIdx === 0;

        let gridTop = PAGE_HEIGHT - MARGIN;
        if (isFirstPage && title) {
          doc.font('Helvetica-Bold').fontSize(24);
          const textWidth = doc.widthOfString(title);
          doc.text(title, (PAGE_WIDTH - textWidth) / 2, MARGIN, { lineBreak: false });
          gridTop -= TITLE_HEIGHT;
        }

        const gridHeight = gridTop - MARGIN;
        const cellHeight = (gridHeight - (ROWS - 1) * CELL_GAP) / ROWS;

        const startIdx = pageIdx * itemsPerPage;
        const pageSvgs = validSvgs.slice(startIdx, startIdx + itemsPerPage);

        for (let i = 0; i < pageSvgs.length; i++) {
          const col = i % COLS;
          const row = Math.floor(i / COLS);
          const x = MARGIN + col * (cellWidth + CELL_GAP);
          const y = PAGE_HEIGHT - gridTop + row * (cellHeight + CELL_GAP);

          try {
            SVGtoPDF(doc, pageSvgs[i], x, y, {
              width: cellWidth,
              height: cellHeight,
              preserveAspectRatio: 'xMidYMid meet',
            });
          } catch (err) {
            logger.warn?.('catalog.svg.embedFailed', { index: startIdx + i, error: err.message });
          }
        }
      }

      await new Promise((resolve) => {
        doc.on('end', resolve);
        doc.end();
      });

      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${title}.pdf"`);
      res.send(pdfBuffer);

    } catch (err) {
      logger.error?.('catalog.render.failed', { error: err.message });
      res.status(500).json({ error: 'Catalog generation failed' });
    }
  });

  return router;
}

/**
 * Find embedded SVG images (data:image/svg+xml;base64,...) and convert to PNG via resvg.
 * This is needed because svg-to-pdfkit can't handle SVG-in-SVG base64 images.
 */
function convertEmbeddedSvgsToPng(svgText) {
  return svgText.replace(
    /href="data:image\/svg\+xml;base64,([^"]+)"/g,
    (match, b64) => {
      try {
        const svgContent = Buffer.from(b64, 'base64').toString('utf-8');
        const resvg = new Resvg(svgContent, { fitTo: { mode: 'width', value: 200 } });
        const pngBuf = resvg.render().asPng();
        const pngB64 = Buffer.from(pngBuf).toString('base64');
        return `href="data:image/png;base64,${pngB64}"`;
      } catch {
        return match;
      }
    }
  );
}
