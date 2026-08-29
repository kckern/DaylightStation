/**
 * Printable sheet router — `GET /api/v1/sheets/:id.pdf`
 *
 * Serves the config-driven printable interaction surfaces: pages of scannable
 * marks (QR, bar code, label) that act as input devices. The nutrition fridge
 * sheet is the first of them.
 *
 * Query params are forwarded verbatim to the sheet's providers. That is what
 * lets a data-driven sheet — one whose items depend on a runtime argument, like
 * the content catalog's `?source=&id=` — be a config entry rather than its own
 * bespoke router.
 *
 * @module api/v1/routers/sheets
 */
import express from 'express';

/**
 * A structural failure means the sheet does not exist as described — a bad id, a
 * provider or cell kind nothing implements, an unsupported page size. That is a
 * 404: the resource genuinely is not there. Anything else (a provider that threw,
 * a renderer that died) is a server fault and must not be dressed up as "missing",
 * or a broken backend reads to the caller as a typo in their URL.
 *
 * The wording is a contract with `SheetService`, which throws these phrasings.
 */
const STRUCTURAL = /unknown (sheet|source|cell kind|page size)/i;

/**
 * @param {object} deps
 * @param {Object} deps.printableSheets
 * @param {object} [deps.logger]
 * @returns {import('express').Router}
 */
export function createSheetsRouter({ printableSheets, logger = console }) {
  const router = express.Router();

  router.get('/:id.pdf', async (req, res) => {
    const { id } = req.params;
    try {
      const { model, pdf } = await printableSheets.render(id, req.query);

      res.setHeader('Content-Type', 'application/pdf');
      // The fingerprint rides in the filename so a saved or printed copy carries
      // its provenance even once it is separated from the page footer.
      res.setHeader('Content-Disposition', `inline; filename="${id}-${model.fingerprint}.pdf"`);
      res.send(pdf);

      logger.info?.('sheet.rendered', { sheet: id, fingerprint: model.fingerprint, bytes: pdf.length });
    } catch (err) {
      const structural = STRUCTURAL.test(err.message || '');
      logger.warn?.('sheet.render.failed', { sheet: id, structural, error: err.message });
      res.status(structural ? 404 : 500).json({ error: err.message });
    }
  });

  return router;
}
