import express from 'express';
export function createArcadeBluetoothRouter({ service, logger = {} }) {
  const router = express.Router();
  router.use(express.json({ limit: 8192 }));
  const serve = (command) => async (req, res) => {
    try {
      const result = command
        ? await service.command(req.params.deviceId, command === true ? req.params.action : command, req.body)
        : await service.state(req.params.deviceId);
      res.set('Cache-Control', 'no-store').status(command ? 202 : 200).json(result);
    } catch (error) {
      const status = Number.isInteger(error.status) ? error.status : 502;
      logger.warn?.('arcade.bluetooth.request-failed', { deviceId: req.params.deviceId, status });
      res.status(status).json({ ok: false, code: error.code || 'request_failed', error: error.status ? error.message : 'Controller recovery is unavailable' });
    }
  };
  router.get('/:deviceId', serve(false));
  router.post('/:deviceId/scan/stop', serve('scan/stop'));
  router.post('/:deviceId/:action', serve(true));
  return router;
}
