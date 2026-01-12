/**
 * JournalService - Journal entry operations
 */

import { JournalEntry } from '../entities/JournalEntry.mjs';

export class JournalService {
  constructor({ journalStore }) {
    this.journalStore = journalStore;
  }

  /**
   * Create a journal entry
   */
  async createEntry(data) {
    const entry = new JournalEntry({
      id: data.id || this.generateId(),
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
   */
  async updateEntry(id, updates) {
    const entry = await this.getEntry(id);
    if (!entry) throw new Error(`Entry not found: ${id}`);

    if (updates.content !== undefined) entry.updateContent(updates.content);
    if (updates.mood !== undefined) entry.setMood(updates.mood);
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

  generateId() {
    return `journal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default JournalService;
