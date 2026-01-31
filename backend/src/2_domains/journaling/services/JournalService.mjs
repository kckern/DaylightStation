/**
 * JournalService - Journal entry operations
 */

import { JournalEntry } from '../entities/JournalEntry.mjs';
import { ValidationError } from '../../core/errors/index.mjs';

export class JournalService {
  constructor({ journalStore }) {
    this.journalStore = journalStore;
  }

  /**
   * Create a journal entry
   * @param {Object} data - Entry data
   * @param {string} timestamp - ISO timestamp (required, from application layer)
   */
  async createEntry(data, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    const nowMs = new Date(timestamp).getTime();
    const entry = new JournalEntry({
      id: data.id || this.generateId(nowMs),
      createdAt: timestamp,
      ...data
    });
    await this.journalStore.save(entry);
    return entry;
  }

  /**
   * Get entry by ID
   */
  async getEntry(id) {
    const data = await this.journalStore.findById(id);
    return data ? JournalEntry.fromJSON(data) : null;
  }

  /**
   * Get entry for user and date
   */
  async getEntryByDate(userId, date) {
    const data = await this.journalStore.findByUserAndDate(userId, date);
    return data ? JournalEntry.fromJSON(data) : null;
  }

  /**
   * Update an entry
   * @param {string} id - Entry ID
   * @param {Object} updates - Fields to update
   * @param {string} timestamp - ISO timestamp (required, from application layer)
   */
  async updateEntry(id, updates, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    const entry = await this.getEntry(id);
    if (!entry) throw new Error(`Entry not found: ${id}`);

    if (updates.content !== undefined) entry.updateContent(updates.content, timestamp);
    if (updates.mood !== undefined) entry.setMood(updates.mood, timestamp);
    if (updates.title !== undefined) entry.title = updates.title;

    await this.journalStore.save(entry);
    return entry;
  }

  /**
   * Delete an entry
   */
  async deleteEntry(id) {
    await this.journalStore.delete(id);
  }

  /**
   * Get entries in date range
   */
  async getEntriesInRange(userId, startDate, endDate) {
    const entries = await this.journalStore.findByUserInRange(userId, startDate, endDate);
    return entries.map(e => JournalEntry.fromJSON(e));
  }

  /**
   * Get entries by tag
   */
  async getEntriesByTag(userId, tag) {
    const entries = await this.journalStore.findByUserAndTag(userId, tag);
    return entries.map(e => JournalEntry.fromJSON(e));
  }

  /**
   * Get mood summary for date range
   */
  async getMoodSummary(userId, startDate, endDate) {
    const entries = await this.getEntriesInRange(userId, startDate, endDate);
    const moodCounts = { great: 0, good: 0, okay: 0, bad: 0, awful: 0 };

    for (const entry of entries) {
      if (entry.mood && moodCounts[entry.mood] !== undefined) {
        moodCounts[entry.mood]++;
      }
    }

    return {
      startDate,
      endDate,
      totalEntries: entries.length,
      entriesWithMood: entries.filter(e => e.hasMood()).length,
      moodCounts
    };
  }

  /**
   * Generate a unique ID for a journal entry
   * @param {number} nowMs - Current timestamp in milliseconds (from application layer)
   * @returns {string}
   */
  generateId(nowMs) {
    if (typeof nowMs !== 'number') {
      throw new ValidationError('nowMs required', { code: 'MISSING_TIMESTAMP', field: 'nowMs' });
    }
    return `journal-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default JournalService;
