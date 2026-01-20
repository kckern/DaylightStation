/**
 * Journaling API Router
 *
 * REST API endpoints for journal entry operations.
 */
import express from 'express';
import { JournalService } from '../../1_domains/journaling/services/JournalService.mjs';
import { YamlJournalStore } from '../../2_adapters/persistence/yaml/YamlJournalStore.mjs';

const router = express.Router();

/**
 * Create router with dependencies
 * @param {Object} deps
 * @param {string} deps.dataRoot - Data root directory
 * @param {Object} [deps.logger] - Logger instance
 * @returns {express.Router}
 */
export function createJournalingRouter(deps) {
  const { dataRoot, logger } = deps;

  const journalStore = new YamlJournalStore({ dataRoot });
  const journalService = new JournalService({ journalStore });

  /**
   * GET /api/journaling
   * Get journaling module overview
   */
  router.get('/', async (req, res) => {
    try {
      const { hid } = req.query;
      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const dates = await journalStore.listDates(hid);
      const tags = await journalStore.getAllTags(hid);

      res.json({
        module: 'journaling',
        householdId: hid,
        totalEntries: dates.length,
        mostRecentDate: dates[0] || null,
        tags
      });
    } catch (error) {
      logger?.error?.('journaling.overview.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/journaling/entries/dates
   * List all dates with journal entries
   */
  router.get('/entries/dates', async (req, res) => {
    try {
      const { hid } = req.query;
      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const dates = await journalStore.listDates(hid);
      res.json({ dates });
    } catch (error) {
      logger?.error?.('journaling.listDates.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/journaling/entries/:date
   * Get journal entry for a specific date
   */
  router.get('/entries/:date', async (req, res) => {
    try {
      const { hid } = req.query;
      const { date } = req.params;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const entry = await journalService.getEntryByDate(hid, date);
      if (!entry) {
        return res.status(404).json({ error: 'Journal entry not found' });
      }

      res.json(entry);
    } catch (error) {
      logger?.error?.('journaling.getEntry.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/journaling/entries
   * Create a new journal entry
   */
  router.post('/entries', async (req, res) => {
    try {
      const { hid } = req.query;
      const entryData = req.body;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const entry = await journalService.createEntry({
        userId: hid,
        ...entryData
      });

      res.status(201).json(entry);
    } catch (error) {
      logger?.error?.('journaling.createEntry.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/journaling/entries/:id
   * Update a journal entry
   */
  router.put('/entries/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const entry = await journalService.updateEntry(id, updates);
      res.json(entry);
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      logger?.error?.('journaling.updateEntry.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/journaling/entries/:id
   * Delete a journal entry
   */
  router.delete('/entries/:id', async (req, res) => {
    try {
      const { id } = req.params;

      await journalService.deleteEntry(id);
      res.json({ success: true });
    } catch (error) {
      logger?.error?.('journaling.deleteEntry.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/journaling/range
   * Get journal entries for a date range
   */
  router.get('/range', async (req, res) => {
    try {
      const { hid, startDate, endDate } = req.query;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Missing startDate or endDate' });
      }

      const entries = await journalService.getEntriesInRange(hid, startDate, endDate);
      res.json({ entries });
    } catch (error) {
      logger?.error?.('journaling.range.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/journaling/by-tag/:tag
   * Get journal entries by tag
   */
  router.get('/by-tag/:tag', async (req, res) => {
    try {
      const { hid } = req.query;
      const { tag } = req.params;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const entries = await journalService.getEntriesByTag(hid, tag);
      res.json({ entries });
    } catch (error) {
      logger?.error?.('journaling.byTag.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/journaling/mood-summary
   * Get mood summary for a date range
   */
  router.get('/mood-summary', async (req, res) => {
    try {
      const { hid, startDate, endDate } = req.query;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Missing startDate or endDate' });
      }

      const summary = await journalService.getMoodSummary(hid, startDate, endDate);
      res.json(summary);
    } catch (error) {
      logger?.error?.('journaling.moodSummary.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/journaling/tags
   * Get all tags used by a user
   */
  router.get('/tags', async (req, res) => {
    try {
      const { hid } = req.query;

      if (!hid) {
        return res.status(400).json({ error: 'Missing household ID (hid)' });
      }

      const tags = await journalStore.getAllTags(hid);
      res.json({ tags });
    } catch (error) {
      logger?.error?.('journaling.tags.error', { error: error.message });
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

export default router;
