import express from 'express';

export const VENDOR_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Serves `<mediaDir>/vendor/**` (fonts, presets, shaders installed by
 * `npm run install:assets`). Mount at `/vendor`. Files are content-pinned by
 * the asset manifest, so they are served immutable; an absent file is a plain
 * 404 so callers can fall back.
 */
export function createVendorRouter({ vendorDir, logger = console }) {
  if (!vendorDir) throw new TypeError('createVendorRouter requires vendorDir');
  const router = express.Router();

  router.use(express.static(vendorDir, {
    index: false,
    dotfiles: 'ignore',
    fallthrough: true,
    etag: true,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', VENDOR_CACHE_CONTROL);
      // SVG is scriptable same-origin content if navigated to directly. <img>, fetch(),
      // @font-face and <script src> ignore a response CSP, so no consumer is affected.
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));

  router.use((req, res) => {
    logger.debug?.('vendor.miss', { path: req.path });
    res.status(404).json({ error: 'Vendor asset not found', path: req.path });
  });

  return router;
}

export default createVendorRouter;
