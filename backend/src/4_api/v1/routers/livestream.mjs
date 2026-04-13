/**
 * Livestream API Router
 *
 * Endpoints:
 * - GET    /:channel/listen          — Audio stream (chunked AAC)
 * - GET    /channels                 — List all channels
 * - POST   /channels                 — Create a channel
 * - GET    /:channel                 — Channel status
 * - PUT    /:channel                 — Update channel config
 * - DELETE /:channel                 — Destroy a channel
 * - POST   /:channel/queue           — Queue audio files
 * - DELETE /:channel/queue/:index    — Remove item from queue
 * - POST   /:channel/skip            — Skip current track
 * - POST   /:channel/force           — Force-play a file immediately
 * - POST   /:channel/stop            — Stop playback
 * - POST   /:channel/program/start   — Start a program (placeholder)
 * - POST   /:channel/program/stop    — Stop a program (placeholder)
 * - POST   /:channel/input/:choice   — Button input (a/b/c/d)
 */
import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

/**
 * Create livestream router.
 *
 * @param {Object} config
 * @param {import('#apps/livestream/ChannelManager.mjs').ChannelManager} config.channelManager
 * @param {Object} [config.logger]
 * @returns {express.Router}
 */
export function createLivestreamRouter(config) {
  const router = express.Router();
  const { channelManager, logger = console } = config;

  router.use(express.json({ strict: false }));

  // ── Literal routes first (before :channel param) ──────────────────

  router.get('/channels', (req, res) => {
    res.json({ channels: channelManager.listChannels() });
  });

  router.post('/channels', asyncHandler(async (req, res) => {
    const { name, ...channelConfig } = req.body;
    if (!name) return res.status(400).json({ error: 'Channel name is required' });
    try {
      channelManager.create(name, channelConfig);
      res.status(201).json(channelManager.getStatus(name));
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  }));

  // ── Stream endpoint — the "radio station" ─────────────────────────

  router.get('/:channel/listen', (req, res) => {
    const { channel } = req.params;
    try {
      const { stream, clientId } = channelManager.getClientStream(channel);
      res.writeHead(200, {
        'Content-Type': 'audio/aac',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'keep-alive',
        'icy-name': `DaylightStation - ${channel}`,
        'icy-pub': '0',
        'Access-Control-Allow-Origin': '*',
      });
      stream.pipe(res);
      req.on('close', () => {
        stream.destroy();
        logger.info?.('livestream.client.disconnected', { channel, clientId });
      });
      logger.info?.('livestream.client.connected', { channel, clientId });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // ── Channel CRUD (parameterized) ──────────────────────────────────

  router.get('/:channel', (req, res) => {
    try {
      res.json(channelManager.getStatus(req.params.channel));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  router.put('/:channel', asyncHandler(async (req, res) => {
    const { channel } = req.params;
    try {
      const status = channelManager.getStatus(channel);
      channelManager.destroy(channel);
      channelManager.create(channel, { ...status, ...req.body });
      res.json(channelManager.getStatus(channel));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }));

  router.delete('/:channel', (req, res) => {
    try {
      channelManager.destroy(req.params.channel);
      res.json({ ok: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // ── Playback control ──────────────────────────────────────────────

  router.post('/:channel/queue', asyncHandler(async (req, res) => {
    const { files } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'files array is required' });
    }
    channelManager.queueFiles(req.params.channel, files);
    res.json(channelManager.getStatus(req.params.channel));
  }));

  router.delete('/:channel/queue/:index', (req, res) => {
    const index = parseInt(req.params.index, 10);
    channelManager.removeFromQueue(req.params.channel, index);
    res.json(channelManager.getStatus(req.params.channel));
  });

  router.post('/:channel/skip', (req, res) => {
    channelManager.skip(req.params.channel);
    res.json(channelManager.getStatus(req.params.channel));
  });

  router.post('/:channel/force', asyncHandler(async (req, res) => {
    const { file } = req.body;
    if (!file) return res.status(400).json({ error: 'file is required' });
    channelManager.forcePlay(req.params.channel, file);
    res.json(channelManager.getStatus(req.params.channel));
  }));

  router.post('/:channel/stop', (req, res) => {
    channelManager.stopPlayback(req.params.channel);
    res.json(channelManager.getStatus(req.params.channel));
  });

  // ── Program control (placeholder — wired in Task 9) ───────────────

  router.post('/:channel/program/start', asyncHandler(async (req, res) => {
    const { program } = req.body;
    if (!program) return res.status(400).json({ error: 'program name is required' });
    logger.info?.('livestream.program.start.request', { channel: req.params.channel, program });
    res.json({ ok: true, message: 'Program support coming in next phase' });
  }));

  router.post('/:channel/program/stop', (req, res) => {
    logger.info?.('livestream.program.stop.request', { channel: req.params.channel });
    res.json({ ok: true, message: 'Program support coming in next phase' });
  });

  // ── Button input ──────────────────────────────────────────────────

  router.post('/:channel/input/:choice', (req, res) => {
    const { channel, choice } = req.params;
    const validChoices = ['a', 'b', 'c', 'd'];
    if (!validChoices.includes(choice.toLowerCase())) {
      return res.status(400).json({ error: `Invalid choice "${choice}". Must be a, b, c, or d` });
    }
    channelManager.sendInput(channel, choice.toLowerCase());
    res.json({ ok: true, channel, choice });
  });

  return router;
}

export default createLivestreamRouter;
