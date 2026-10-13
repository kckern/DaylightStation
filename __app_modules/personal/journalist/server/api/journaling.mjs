/**
 * Journaling API Router
 *
 * REST API endpoints for journal entry operations.
 */
import express from 'express';
import { nowTs24 } from '#system/utils/index.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';

function serializeJournalEntry(entry) {
  return {
    id: entry.id,
    userId: entry.userId,
    date: entry.date,
    title: entry.title,
    content: entry.content,
    mood: entry.mood,
    tags: entry.tags,
    gratitudeItems: entry.gratitudeItems,
    prompts: entry.prompts,
    attachments: entry.attachments,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    metadata: entry.metadata
  };
}

/**
 * Create journaling API router
 * @param {Object} config
 * @param {Object} config.journalOperations - Cohesive journal queries and commands
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 *
 */
export function createJournalingRouter(config) {
  const { journalOperations, logger = console } = config;

  const router = express.Router();

  /**
   * GET /api/journaling
   * Get journaling module overview
   */
  router.get('/', asyncHandler(async (req, res) => {
    const { hid } = req.query;
    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const dates = await journalOperations.listDates(hid);
    const tags = await journalOperations.listTags(hid);

    res.json({
      module: 'journaling',
      householdId: hid,
      totalEntries: dates.length,
      mostRecentDate: dates[0] || null,
      tags
    });
  }));

  /**
   * GET /api/journaling/entries/dates
   * List all dates with journal entries
   */
  router.get('/entries/dates', asyncHandler(async (req, res) => {
    const { hid } = req.query;
    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const dates = await journalOperations.listDates(hid);
    res.json({ dates });
  }));

  /**
   * GET /api/journaling/entries/:date
   * Get journal entry for a specific date
   */
  router.get('/entries/:date', asyncHandler(async (req, res) => {
    const { hid } = req.query;
    const { date } = req.params;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const entry = await journalOperations.readByDate(hid, date);
    if (!entry) {
      return res.status(404).json({ error: 'Journal entry not found' });
    }

    res.json(serializeJournalEntry(entry));
  }));

  /**
   * POST /api/journaling/entries
   * Create a new journal entry
   */
  router.post('/entries', asyncHandler(async (req, res) => {
    const { hid } = req.query;
    const entryData = req.body;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const timestamp = nowTs24();
    const entry = await journalOperations.create({
      userId: hid,
      ...entryData
    }, timestamp);

    res.status(201).json(serializeJournalEntry(entry));
  }));

  /**
   * PUT /api/journaling/entries/:id
   * Update a journal entry
   */
  router.put('/entries/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    try {
      const timestamp = nowTs24();
      const entry = await journalOperations.update(id, updates, timestamp);
      res.json(serializeJournalEntry(entry));
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      throw error;
    }
  }));

  /**
   * DELETE /api/journaling/entries/:id
   * Delete a journal entry
   */
  router.delete('/entries/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    await journalOperations.delete(id);
    res.json({ success: true });
  }));

  /**
   * GET /api/journaling/range
   * Get journal entries for a date range
   */
  router.get('/range', asyncHandler(async (req, res) => {
    const { hid, startDate, endDate } = req.query;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Missing startDate or endDate' });
    }

    const entries = await journalOperations.readRange(hid, startDate, endDate);
    res.json({ entries: entries.map(serializeJournalEntry) });
  }));

  /**
   * GET /api/journaling/by-tag/:tag
   * Get journal entries by tag
   */
  router.get('/by-tag/:tag', asyncHandler(async (req, res) => {
    const { hid } = req.query;
    const { tag } = req.params;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const entries = await journalOperations.readByTag(hid, tag);
    res.json({ entries: entries.map(serializeJournalEntry) });
  }));

  /**
   * GET /api/journaling/mood-summary
   * Get mood summary for a date range
   */
  router.get('/mood-summary', asyncHandler(async (req, res) => {
    const { hid, startDate, endDate } = req.query;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Missing startDate or endDate' });
    }

    const summary = await journalOperations.moodSummary(hid, startDate, endDate);
    res.json(summary);
  }));

  /**
   * GET /api/journaling/tags
   * Get all tags used by a user
   */
  router.get('/tags', asyncHandler(async (req, res) => {
    const { hid } = req.query;

    if (!hid) {
      return res.status(400).json({ error: 'Missing household ID (hid)' });
    }

    const tags = await journalOperations.listTags(hid);
    res.json({ tags });
  }));

  return router;
}

export default createJournalingRouter;
