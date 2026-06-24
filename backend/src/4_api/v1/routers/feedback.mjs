import express from 'express';

/**
 * Feedback API — app-wide voice-feedback capture + inbox (mounted at
 * /api/v1/feedback). The browser records audio and snapshots its own recent
 * logs; this layer persists, transcribes (background), and serves the inbox.
 *
 *   POST   /                  → create  (body: { app, audioBase64, mimeType, durationMs, context, logs })
 *   GET    /?app=             → list    ({ items: [...] }) — inbox, newest first
 *   GET    /:app/:id          → one full item (transcript, logs, context)
 *   GET    /:app/:id/audio    → the recorded audio file
 *   PATCH  /:app/:id          → triage  (body: { status?, notes? })
 *   DELETE /:app/:id          → remove item + audio
 */
export function createFeedbackRouter({ feedbackService, logger = console }) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const { app, audioBase64, mimeType, durationMs, context, logs } = req.body || {};
      if (!app) return res.status(400).json({ error: 'app required' });
      const audioBuffer = audioBase64 ? Buffer.from(audioBase64, 'base64') : null;
      const item = await feedbackService.create({ app, audioBuffer, mimeType, durationMs, context, logs });
      res.status(201).json({
        id: item.id, app: item.app, created: item.created,
        status: item.status, transcriptStatus: item.transcriptStatus,
      });
    } catch (err) {
      logger.error?.('feedback.create.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/', (req, res) => {
    try {
      res.json({ items: feedbackService.list({ app: req.query.app || null }) });
    } catch (err) {
      logger.error?.('feedback.list.error', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:app/:id', (req, res) => {
    const item = feedbackService.get(req.params.app, req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(item);
  });

  router.get('/:app/:id/audio', (req, res) => {
    const filePath = feedbackService.audioFilePath(req.params.app, req.params.id);
    if (!filePath) return res.status(404).json({ error: 'audio not found' });
    res.sendFile(filePath);
  });

  router.patch('/:app/:id', (req, res) => {
    const item = feedbackService.update(req.params.app, req.params.id, req.body || {});
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(item);
  });

  router.delete('/:app/:id', (req, res) => {
    const ok = feedbackService.remove(req.params.app, req.params.id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true, id: req.params.id });
  });

  return router;
}

export default createFeedbackRouter;
