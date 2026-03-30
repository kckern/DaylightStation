import express from 'express';

export function createWeeklyReviewRouter(config) {
  const { weeklyReviewService, logger = console } = config;
  const router = express.Router();

  router.get('/bootstrap', async (req, res) => {
    try {
      const { week } = req.query;
      const data = await weeklyReviewService.bootstrap(week || undefined);
      res.json(data);
    } catch (err) {
      logger.error?.('weekly-review.bootstrap.error', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/recording', async (req, res) => {
    try {
      const { audioBase64, mimeType, week, duration } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        return res.status(400).json({ ok: false, error: 'audioBase64 required' });
      }
      if (!week) {
        return res.status(400).json({ ok: false, error: 'week required' });
      }

      const result = await weeklyReviewService.saveRecording({ audioBase64, mimeType, week, duration });
      res.json(result);
    } catch (err) {
      logger.error?.('weekly-review.recording.error', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
