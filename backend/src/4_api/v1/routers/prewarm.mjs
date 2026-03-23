import { Router } from 'express';

export function createPrewarmRouter(config) {
  const { prewarmService } = config;
  if (!prewarmService) throw new Error('prewarmService is required');

  const router = Router();

  router.get('/:token', (req, res) => {
    const url = prewarmService.redeem(req.params.token);
    if (!url) {
      return res.status(404).json({ error: 'Token not found or expired' });
    }
    res.json({ url });
  });

  return router;
}

export default createPrewarmRouter;
