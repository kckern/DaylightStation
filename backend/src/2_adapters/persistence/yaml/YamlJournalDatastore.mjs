/**
 * YamlJournalDatastore - YAML-based journal entry persistence
 *
 * Implements IJournalDatastore port for journal entry storage.
 * Entries stored at: households/{hid}/apps/journal/entries/{YYYY-MM-DD}.yml
 */
import path from 'path';
import {
  ensureDir,
  dirExists,
  fileExists,
  listYamlFiles,
  listDirs,
  loadYamlSafe,
  saveYaml,
  deleteYaml
} from '../../../0_system/utils/FileIO.mjs';
import { IJournalDatastore } from '#apps/journaling/ports/IJournalDatastore.mjs';

export class YamlJournalDatastore extends IJournalDatastore {
  /**
   * @param {Object} config
   * @param {string} config.dataRoot - Base data directory
   */
  constructor(config) {
    super();
    if (!config.dataRoot) throw new Error('YamlJournalDatastore requires dataRoot');
    this.dataRoot = config.dataRoot;
  }

  /**
   * Get storage path for a journal entry
   * @param {string} userId - User/household ID
   * @param {string} date - YYYY-MM-DD format
   * @returns {string}
   */
  getEntryPath(userId, date) {
    return path.join(
      this.dataRoot,
      'households',
      userId,
      'apps',
      'journal',
      'entries',
      date
    );
  }

  /**
   * Get the entries directory for a user
   * @param {string} userId
   * @returns {string}
   */
  getEntriesDir(userId) {
    return path.join(
      this.dataRoot,
      'households',
      userId,
      'apps',
      'journal',
      'entries'
    );
  }

  /**
   * Read a YAML file
   * @param {string} basePath
   * @returns {Object|null}
   */
  _readFile(basePath) {
    return loadYamlSafe(basePath);
  }

  /**
   * Write a YAML file
   * @param {string} basePath
   * @param {Object} data
   */
  _writeFile(basePath, data) {
    ensureDir(path.dirname(basePath));
    saveYaml(basePath, data);
  }

  /**
   * Save a journal entry
   * @param {Object} entry - Journal entry entity or plain object
   * @returns {Promise<void>}
   */
  async save(entry) {
    const data = typeof entry.toJSON === 'function' ? entry.toJSON() : entry;
    const filePath = this.getEntryPath(data.userId, data.date);
    this._writeFile(filePath, data);
  }

  /**
   * Find journal entry by ID
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    // ID format: journal-{timestamp}-{random} or {userId}-{date}
    // Extract date from ID if possible
    const dateMatch = id.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) return null;

    // Search all users for this ID - in production would use userId
    const householdsDir = path.join(this.dataRoot, 'households');
    if (!dirExists(householdsDir)) return null;

    const users = listDirs(householdsDir);
    for (const userId of users) {
      const entry = await this.findByUserAndDate(userId, dateMatch[1]);
      if (entry && entry.id === id) {
        return entry;
      }
    }
    return null;
  }

  /**
   * Find journal entry by user ID and date
   * @param {string} userId
   * @param {string} date - YYYY-MM-DD
   * @returns {Promise<Object|null>}
   */
  async findByUserAndDate(userId, date) {
    const filePath = this.getEntryPath(userId, date);
    return this._readFile(filePath);
  }

  /**
   * Find journal entries for user in date range
   * @param {string} userId
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Promise<Object[]>}
   */
  async findByUserInRange(userId, startDate, endDate) {
    const dates = await this.listDates(userId);
    const filtered = dates.filter(d => d >= startDate && d <= endDate);

    const entries = [];
    for (const date of filtered) {
      const entry = await this.findByUserAndDate(userId, date);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Find journal entries by user and tag
   * @param {string} userId
   * @param {string} tag
   * @returns {Promise<Object[]>}
   */
  async findByUserAndTag(userId, tag) {
    const dates = await this.listDates(userId);

    const entries = [];
    for (const date of dates) {
      const entry = await this.findByUserAndDate(userId, date);
      if (entry && entry.tags?.includes(tag)) {
        entries.push(entry);
      }
    }

    return entries.sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * List all dates with journal entries for a user
   * @param {string} userId
   * @returns {Promise<string[]>}
   */
  async listDates(userId) {
    const entriesDir = this.getEntriesDir(userId);

    if (!dirExists(entriesDir)) return [];

    return listYamlFiles(entriesDir, { stripExtension: true })
      .filter(name => /^\d{4}-\d{2}-\d{2}$/.test(name))
      .sort()
      .reverse();
  }

  /**
   * Delete a journal entry
   * @param {string} id - Entry ID
   * @returns {Promise<void>}
   */
  async delete(id) {
    // Find the entry first to get the file path
    const entry = await this.findById(id);
    if (!entry) return;

    const basePath = this.getEntryPath(entry.userId, entry.date);
    deleteYaml(basePath);
  }

  /**
   * Get mood summary for date range
   * @param {string} userId
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Promise<Object>}
   */
  async getMoodSummary(userId, startDate, endDate) {
    const entries = await this.findByUserInRange(userId, startDate, endDate);
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
      entriesWithMood: entries.filter(e => e.mood).length,
      moodCounts
    };
  }

  /**
   * Get all tags used by a user
   * @param {string} userId
   * @returns {Promise<string[]>}
   */
  async getAllTags(userId) {
    const dates = await this.listDates(userId);
    const tagsSet = new Set();

    for (const date of dates) {
      const entry = await this.findByUserAndDate(userId, date);
      if (entry?.tags) {
        entry.tags.forEach(tag => tagsSet.add(tag));
      }
    }

    return Array.from(tagsSet).sort();
  }
}

export default YamlJournalDatastore;
