/**
 * JournalEntry Entity - Represents a journal entry
 */

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
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = updatedAt;
    this.metadata = metadata;
  }

  /**
   * Update content
   */
  updateContent(newContent) {
    this.content = newContent;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Set mood
   */
  setMood(mood) {
    this.mood = mood;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Add gratitude item
   */
  addGratitudeItem(item) {
    this.gratitudeItems.push(item);
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Add tag
   */
  addTag(tag) {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      this.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Remove tag
   */
  removeTag(tag) {
    this.tags = this.tags.filter(t => t !== tag);
    this.updatedAt = new Date().toISOString();
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
