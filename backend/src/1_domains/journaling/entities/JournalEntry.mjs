/**
 * JournalEntry Entity - Represents a journal entry
 */

import { ValidationError } from '../../core/errors/index.mjs';

export class JournalEntry {
  constructor({
    id,
    userId,
    date,
    title = '',
    content = '',
    mood = null,
    tags = [],
    gratitudeItems = [],
    prompts = [],
    attachments = [],
    createdAt,
    updatedAt = null,
    metadata = {}
  }) {
    this.id = id;
    this.userId = userId;
    this.date = date;
    this.title = title;
    this.content = content;
    this.mood = mood; // 'great', 'good', 'okay', 'bad', 'awful'
    this.tags = tags;
    this.gratitudeItems = gratitudeItems;
    this.prompts = prompts; // Array of prompt objects used to generate entry
    this.attachments = attachments; // Array of attachment objects (photos, voice memos)
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.metadata = metadata;
  }

  /**
   * Update content
   * @param {string} newContent - New content
   * @param {string} timestamp - Timestamp for the update (required)
   * @throws {ValidationError} If timestamp is not provided
   */
  updateContent(newContent, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for updateContent');
    }
    this.content = newContent;
    this.updatedAt = timestamp;
  }

  /**
   * Set mood
   * @param {string} mood - Mood value
   * @param {string} timestamp - Timestamp for the update (required)
   * @throws {ValidationError} If timestamp is not provided
   */
  setMood(mood, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for setMood');
    }
    this.mood = mood;
    this.updatedAt = timestamp;
  }

  /**
   * Add gratitude item
   * @param {Object} item - Gratitude item to add
   * @param {string} timestamp - Timestamp for the update (required)
   * @throws {ValidationError} If timestamp is not provided
   */
  addGratitudeItem(item, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for addGratitudeItem');
    }
    this.gratitudeItems.push(item);
    this.updatedAt = timestamp;
  }

  /**
   * Add tag
   * @param {string} tag - Tag to add
   * @param {string} timestamp - Timestamp for the update (required)
   * @throws {ValidationError} If timestamp is not provided
   */
  addTag(tag, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for addTag');
    }
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      this.updatedAt = timestamp;
    }
  }

  /**
   * Remove tag
   * @param {string} tag - Tag to remove
   * @param {string} timestamp - Timestamp for the update (required)
   * @throws {ValidationError} If timestamp is not provided
   */
  removeTag(tag, timestamp) {
    if (!timestamp) {
      throw new ValidationError('timestamp is required for removeTag');
    }
    this.tags = this.tags.filter(t => t !== tag);
    this.updatedAt = timestamp;
  }

  /**
   * Get word count
   */
  getWordCount() {
    return this.content.split(/\s+/).filter(w => w.length > 0).length;
  }

  /**
   * Check if entry has mood
   */
  hasMood() {
    return this.mood !== null;
  }

  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      date: this.date,
      title: this.title,
      content: this.content,
      mood: this.mood,
      tags: this.tags,
      gratitudeItems: this.gratitudeItems,
      prompts: this.prompts,
      attachments: this.attachments,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: this.metadata
    };
  }

  static fromJSON(data) {
    return new JournalEntry(data);
  }
}

export default JournalEntry;
