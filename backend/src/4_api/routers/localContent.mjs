// backend/src/4_api/routers/localContent.mjs
import express from 'express';

/**
 * Create LocalContent API router for scripture, hymns, talks, poetry
 *
 * These endpoints return content-specific response shapes for ContentScroller.
 *
 * @param {Object} config
 * @param {Object} config.registry - ContentSourceRegistry
 * @returns {express.Router}
 */
export function createLocalContentRouter(config) {
  const { registry } = config;
  const router = express.Router();

  /**
   * GET /api/local-content/scripture/*
   * Returns scripture with verse timings for ContentScroller
   */
  router.get('/scripture/*', async (req, res) => {
    try {
      const path = req.params[0] || '';
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`scripture:${path}`);
      if (!item) {
        return res.status(404).json({ error: 'Scripture not found', path });
      }

      // Response shape for ContentScroller scripture mode
      res.json({
        reference: item.metadata.reference,
        media_key: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        volume: item.metadata.volume,
        chapter: item.metadata.chapter,
        verses: item.metadata.verses
      });
    } catch (err) {
      console.error('[localContent] scripture error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/hymn/:number
   * Returns hymn with lyrics (legacy parity with /data/hymn/:number)
   */
  router.get('/hymn/:number', async (req, res) => {
    try {
      const { number } = req.params;
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`hymn:${number}`);
      if (!item) {
        return res.status(404).json({ error: 'Hymn not found', number });
      }

      // Legacy parity: use hymn_num, legacy mediaUrl format
      res.json({
        title: item.title,
        hymn_num: item.metadata.number || parseInt(number, 10),
        verses: item.metadata.verses,
        mediaUrl: `/media/audio/songs/hymn/_ldsgc/${number}`,
        duration: item.duration || item.metadata.duration || 0
      });
    } catch (err) {
      console.error('[localContent] hymn error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/primary/:number
   * Returns primary song with lyrics (legacy parity with /data/primary/:number)
   */
  router.get('/primary/:number', async (req, res) => {
    try {
      const { number } = req.params;
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`primary:${number}`);
      if (!item) {
        return res.status(404).json({ error: 'Primary song not found', number });
      }

      // Legacy parity: use song_number, legacy mediaUrl format
      res.json({
        title: item.title,
        song_number: item.metadata.number || parseInt(number, 10),
        verses: item.metadata.verses,
        mediaUrl: `/media/audio/songs/primary/${number}`,
        duration: item.duration || item.metadata.duration || 0
      });
    } catch (err) {
      console.error('[localContent] primary error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/talk/*
   * Returns talk with paragraphs for ContentScroller
   */
  router.get('/talk/*', async (req, res) => {
    try {
      const path = req.params[0] || '';
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`talk:${path}`);
      if (!item) {
        return res.status(404).json({ error: 'Talk not found', path });
      }

      res.json({
        title: item.title,
        speaker: item.metadata.speaker,
        media_key: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        date: item.metadata.date,
        description: item.metadata.description,
        content: item.metadata.content || []
      });
    } catch (err) {
      console.error('[localContent] talk error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/local-content/poem/*
   * Returns poem with stanzas for ContentScroller
   */
  router.get('/poem/*', async (req, res) => {
    try {
      const path = req.params[0] || '';
      const adapter = registry.get('local-content');

      if (!adapter) {
        return res.status(500).json({ error: 'LocalContent adapter not configured' });
      }

      const item = await adapter.getItem(`poem:${path}`);
      if (!item) {
        return res.status(404).json({ error: 'Poem not found', path });
      }

      res.json({
        title: item.title,
        author: item.metadata.author,
        condition: item.metadata.condition,
        also_suitable_for: item.metadata.also_suitable_for,
        poem_id: item.metadata.poem_id,
        media_key: item.id,
        mediaUrl: item.mediaUrl,
        duration: item.duration,
        verses: item.metadata.verses
      });
    } catch (err) {
      console.error('[localContent] poem error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
