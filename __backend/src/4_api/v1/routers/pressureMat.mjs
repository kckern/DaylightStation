import express from 'express';

/** Thin HTTP translation layer over pressure-mat application operations. */
export function createPressureMatRouter({ pressureMatOperations, logger = console } = {}) {
  if (!pressureMatOperations) throw new Error('createPressureMatRouter requires pressureMatOperations');
  const router = express.Router();

  router.get('/', (req, res) => res.json({ pressureMats: pressureMatOperations.list() }));

  router.get('/:id', (req, res) => {
    const status = pressureMatOperations.read(req.params.id);
    if (!status) return res.status(404).json({ error: 'Pressure mat not found', code: 'NOT_FOUND' });
    res.json(status);
  });

  router.get('/:id/device', route(async (req, res) => {
    res.json(await pressureMatOperations.readDevice(req.params.id));
  }, logger));

  router.post('/:id/recalibrate', route(async (req, res) => {
    res.json(await pressureMatOperations.recalibrate(req.params.id));
  }, logger));

  router.post('/:id/threshold', route(async (req, res) => {
    res.json(await pressureMatOperations.configureThreshold(req.params.id, {
      delta: Number(req.body?.delta),
      gradient: Number(req.body?.gradient),
      stompDelta: req.body?.stompDelta == null ? undefined : Number(req.body.stompDelta),
      stompGradient: req.body?.stompGradient == null ? undefined : Number(req.body.stompGradient),
    }));
  }, logger));

  router.post('/:id/reboot', route(async (req, res) => {
    res.json(await pressureMatOperations.reboot(req.params.id));
  }, logger));

  return router;
}

function route(handler, logger) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      logger.warn?.('pressure_mat.api.error', { method: req.method, path: req.path, error: error.message });
      res.status(error.status || 500).json({ error: error.message, code: error.code || 'PRESSURE_MAT_ERROR' });
    }
  };
}

export default createPressureMatRouter;
