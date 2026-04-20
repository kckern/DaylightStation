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

  router.post('/recording/chunk', async (req, res) => {
    const startMs = Date.now();
    try {
      const { sessionId, seq, week, chunkBase64 } = req.body || {};
      if (!chunkBase64 || typeof chunkBase64 !== 'string') {
        return res.status(400).json({ ok: false, error: 'chunkBase64 required' });
      }
      if (!sessionId || !week || typeof seq !== 'number') {
        return res.status(400).json({ ok: false, error: 'sessionId, seq, week required' });
      }
      const buffer = Buffer.from(chunkBase64, 'base64');
      const result = await weeklyReviewService.appendChunk({ sessionId, seq, week, buffer });
      logger.info?.('weekly-review.api.chunk.response', {
        sessionId, seq, week, bytes: buffer.length, totalBytes: result.totalBytes, duplicate: !!result.duplicate, durationMs: Date.now() - startMs,
      });
      res.json(result);
    } catch (err) {
      const msg = err.message || 'unknown';
      const status = /out-of-order/i.test(msg) ? 409 : /invalid/i.test(msg) ? 400 : 500;
      logger.error?.('weekly-review.api.chunk.error', { error: msg, status, durationMs: Date.now() - startMs });
      res.status(status).json({ ok: false, error: msg });
    }
  });

  router.get('/recording/drafts', async (req, res) => {
    try {
      const { week } = req.query;
      if (!week) return res.status(400).json({ ok: false, error: 'week required' });
      const drafts = await weeklyReviewService.listDrafts(week);
      res.json({ ok: true, drafts });
    } catch (err) {
      logger.error?.('weekly-review.api.drafts-list.error', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/recording/finalize', async (req, res) => {
    const startMs = Date.now();
    try {
      const { sessionId, week, duration } = req.body || {};
      if (!sessionId || !week) return res.status(400).json({ ok: false, error: 'sessionId and week required' });
      const result = await weeklyReviewService.finalizeDraft({ sessionId, week, duration });
      logger.info?.('weekly-review.api.finalize.response', {
        sessionId, week, durationMs: Date.now() - startMs, transcriptCleanLength: result.transcript?.clean?.length,
      });
      res.json(result);
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      logger.error?.('weekly-review.api.finalize.error', { error: err.message, status, durationMs: Date.now() - startMs });
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  router.delete('/recording/drafts/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { week } = req.query;
      if (!week) return res.status(400).json({ ok: false, error: 'week required' });
      const result = await weeklyReviewService.discardDraft({ sessionId, week });
      res.json(result);
    } catch (err) {
      logger.error?.('weekly-review.api.discard.error', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
