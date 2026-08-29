import { sendInternalError } from '#api/utils/internalError.mjs';
import express from 'express';

/** Thin HTTP adapter for the injected QR generation operation. */
const DISPLAY_PARAMS = new Set([
  'data', 'content', 'options', 'label', 'sublabel', 'logo', 'size', 'style', 'fg', 'bg',
]);

export function createQRCodeRouter({ generateQRCode, contentExpression, logger = console } = {}) {
  if (typeof generateQRCode !== 'function' || !contentExpression?.fromQuery) {
    throw new Error('createQRCodeRouter requires generateQRCode and contentExpression');
  }
  const router = express.Router();
  router.get('/', async (req, res) => {
    try {
      const expressionQuery = Object.fromEntries(Object.entries(req.query)
        .filter(([key]) => !DISPLAY_PARAMS.has(key)));
      const expression = contentExpression.fromQuery(expressionQuery);
      const { data, content, options, screen, label, sublabel, size, style, fg, bg } = req.query;
      if (!data && !content && !expression.action) {
        const error = new Error('Provide an action (queue, play, open), "content", or "data" query param');
        error.name = 'ValidationError';
        throw error;
      }
      const svg = await generateQRCode({
        data, content, options, screen, label, sublabel,
        // The legacy wire value only disables a logo when literally "false".
        logo: req.query.logo !== 'false',
        size: size ? parseInt(size, 10) : undefined,
        style, fg, bg, expression,
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(svg);
    } catch (err) {
      if (err?.name === 'ValidationError') return res.status(400).json({ error: err.message });
      logger.error?.('qrcode.render.failed', { error: err.message });
      return sendInternalError(res, { error: 'QR code generation failed' });
    }
  });
  return router;
}
