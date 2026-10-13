import express from 'express';
import { splatPath } from '#api/utils/wildcard.mjs';

const CACHE_CONTROL = 'public, max-age=86400';

function sendImage(res, image) {
  res.setHeader('Content-Type', image.contentType);
  res.setHeader('Content-Length', image.size);
  res.setHeader('Cache-Control', CACHE_CONTROL);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(image.buffer);
}

export function createStaticRouter({ staticAssetService, logger = console }) {
  if (!staticAssetService) throw new TypeError('createStaticRouter requires staticAssetService');
  const router = express.Router();

  router.get('/entropy/:icon', async (req, res, next) => {
    try {
      const image = await staticAssetService.getImage({ kind: 'entropy', id: req.params.icon });
      if (!image) return res.status(404).json({ error: 'Entropy icon not found', icon: req.params.icon });
      logger.debug?.('static.entropy.served', { icon: req.params.icon });
      sendImage(res, image);
    } catch (error) { next(error); }
  });

  router.get('/art/*splat', async (req, res, next) => {
    const id = splatPath(req);
    try {
      const image = await staticAssetService.getImage({ kind: 'art', id });
      if (!image) return res.status(404).json({ error: 'Art image not found', path: id });
      logger.debug?.('static.art.served', { path: id });
      sendImage(res, image);
    } catch (error) { next(error); }
  });

  router.get('/users/:id', async (req, res, next) => {
    try {
      const image = await staticAssetService.getImage({ kind: 'user', id: req.params.id });
      if (!image) return res.status(404).json({ error: 'User avatar not found', id: req.params.id });
      logger.debug?.('static.users.served', { id: req.params.id });
      sendImage(res, image);
    } catch (error) { next(error); }
  });

  router.get('/equipment/:id', async (req, res, next) => {
    try {
      const image = await staticAssetService.getImage({ kind: 'equipment', id: req.params.id });
      if (!image) return res.status(404).json({ error: 'Equipment image not found', id: req.params.id });
      logger.debug?.('static.equipment.served', { id: req.params.id });
      sendImage(res, image);
    } catch (error) { next(error); }
  });

  router.get('/img/*splat', async (req, res, next) => {
    const id = splatPath(req);
    const width = parseInt(req.query?.w, 10) || null;
    const height = parseInt(req.query?.h, 10) || null;
    try {
      const image = await staticAssetService.getImage({
        kind: 'image', id,
        width: width > 0 ? width : null,
        height: height > 0 ? height : null,
      });
      if (!image) return res.status(404).json({ error: 'Image not found', path: id });
      logger.debug?.('static.img.served', { path: id });
      sendImage(res, image);
    } catch (error) { next(error); }
  });

  return router;
}

export default createStaticRouter;
