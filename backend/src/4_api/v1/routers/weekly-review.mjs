import express from 'express';

export function createWeeklyReviewRouter(config) {
  const { weeklyReviewService, logger = console } = config;
  const router = express.Router();

  router.get('/bootstrap', async (req, res) => {
    const startMs = Date.now();
    try {
      const { week } = req.query;
      logger.info?.('weekly-review.api.bootstrap.request', { week: week || 'default', ip: req.ip });
      const data = await weeklyReviewService.bootstrap(week || undefined);
      const totalPhotos = data.days?.reduce((s, d) => s + (d.photoCount || 0), 0) || 0;
      logger.info?.('weekly-review.api.bootstrap.response', {
        week: data.week,
        dayCount: data.days?.length,
        totalPhotos,
        hasRecording: data.recording?.exists,
        durationMs: Date.now() - startMs,
      });
      res.json(data);
    } catch (err) {
      logger.error?.('weekly-review.api.bootstrap.error', { error: err.message, durationMs: Date.now() - startMs });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/recording', async (req, res) => {
    const startMs = Date.now();
    try {
      const { audioBase64, mimeType, week, duration } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        logger.warn?.('weekly-review.api.recording.validation-failed', { reason: 'missing audioBase64' });
        return res.status(400).json({ ok: false, error: 'audioBase64 required' });
      }
      if (!week) {
        logger.warn?.('weekly-review.api.recording.validation-failed', { reason: 'missing week' });
        return res.status(400).json({ ok: false, error: 'week required' });
      }
      const payloadSizeKb = Math.round(audioBase64.length / 1024);
      logger.info?.('weekly-review.api.recording.request', { week, mimeType, duration, payloadSizeKb, ip: req.ip });

      const result = await weeklyReviewService.saveRecording({ audioBase64, mimeType, week, duration });
      logger.info?.('weekly-review.api.recording.response', {
        week,
        ok: result.ok,
        transcriptRawLength: result.transcript?.raw?.length,
        transcriptCleanLength: result.transcript?.clean?.length,
        durationMs: Date.now() - startMs,
      });
      res.json(result);
    } catch (err) {
      logger.error?.('weekly-review.api.recording.error', { error: err.message, durationMs: Date.now() - startMs });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
