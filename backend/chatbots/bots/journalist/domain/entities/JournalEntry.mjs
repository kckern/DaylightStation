/**
 * JournalEntry Entity
 * @module journalist/domain/entities/JournalEntry
 * 
 * Represents a journal entry aggregated from conversation messages.
 */

import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from '../../../../_lib/errors/index.mjs';
import { EntrySource, isValidEntrySource } from '../value-objects/EntrySource.mjs';

/**
 * @typedef {Object} EntryAnalysis
 * @property {string[]} themes - Key themes identified
 * @property {string} sentiment - Overall sentiment
 * @property {string[]} insights - AI-generated insights
 * @property {string} [therapistNote] - Therapist-style analysis
 */

/**
 * JournalEntry entity
 */
export class JournalEntry {
  #uuid;
  #chatId;
  #date;
  #period;
  #text;
  #source;
  #transcription;
  #analysis;
  #createdAt;

  /**
   * @param {object} props
   */
  constructor(props) {
    if (!props.chatId) throw new ValidationError('chatId is required');
    if (!props.date) throw new ValidationError('date is required');
    if (typeof props.text !== 'string') throw new ValidationError('text must be a string');
    
    const source = props.source || EntrySource.TEXT;
    if (!isValidEntrySource(source)) {
      throw new ValidationError(`Invalid entry source: ${source}`);
    }

    const period = props.period || 'afternoon';
    if (!['morning', 'afternoon', 'evening', 'night'].includes(period)) {
      throw new ValidationError(`Invalid period: ${period}`);
    }

    this.#uuid = props.uuid || uuidv4();
    this.#chatId = props.chatId;
    this.#date = props.date;
    this.#period = period;
    this.#text = props.text;
    this.#source = source;
    this.#transcription = props.transcription || null;
    this.#analysis = props.analysis ? Object.freeze(props.analysis) : null;
    this.#createdAt = props.createdAt || new Date().toISOString();

    Object.freeze(this);
  }

  // ==================== Getters ====================

  get uuid() { return this.#uuid; }
  get chatId() { return this.#chatId; }
  get date() { return this.#date; }
  get period() { return this.#period; }
  get text() { return this.#text; }
  get source() { return this.#source; }
  get transcription() { return this.#transcription; }
  get analysis() { return this.#analysis ? { ...this.#analysis } : null; }
  get createdAt() { return this.#createdAt; }

  // ==================== Computed Properties ====================

  /**
   * Check if entry is from voice
   * @returns {boolean}
   */
  get isVoice() {
    return this.#source === EntrySource.VOICE;
  }

  /**
   * Check if entry has analysis
   * @returns {boolean}
   */
  get hasAnalysis() {
    return this.#analysis !== null;
  }

  /**
   * Get word count
   * @returns {number}
   */
  get wordCount() {
    return this.#text.split(/\s+/).filter(w => w.length > 0).length;
  }

  // ==================== Mutation Methods ====================

  /**
   * Add analysis to entry
   * @param {EntryAnalysis} analysis
   * @returns {JournalEntry}
   */
  withAnalysis(analysis) {
    return new JournalEntry({
      ...this.toJSON(),
      analysis,
    });
  }

  /**
   * Update text
   * @param {string} text
   * @returns {JournalEntry}
   */
  withText(text) {
    return new JournalEntry({
      ...this.toJSON(),
      text,
    });
  }

  // ==================== Factory Methods ====================

  /**
   * Create a new journal entry
   * @param {object} props
   * @returns {JournalEntry}
   */
  static create(props) {
    return new JournalEntry(props);
  }

  /**
   * Create entries from conversation messages
   * @param {import('./ConversationMessage.mjs').ConversationMessage[]} messages
   * @param {string} date
   * @param {string} [botName]
   * @returns {JournalEntry[]}
   */
  static fromMessages(messages, date, botName = 'Journalist') {
    // Group user messages by period
    const userMessages = messages.filter(m => !m.isFromBot(botName));
    
    if (userMessages.length === 0) {
      return [];
    }

    // Determine period from timestamp
    const getPeriod = (timestamp) => {
      const hour = new Date(timestamp).getHours();
      if (hour >= 5 && hour < 12) return 'morning';
      if (hour >= 12 && hour < 17) return 'afternoon';
      if (hour >= 17 && hour < 21) return 'evening';
      return 'night';
    };

    // Group by period and concatenate
    const byPeriod = {};
    for (const msg of userMessages) {
      const period = getPeriod(msg.timestamp);
      if (!byPeriod[period]) {
        byPeriod[period] = [];
      }
      byPeriod[period].push(msg);
    }

    // Create entries
    return Object.entries(byPeriod).map(([period, msgs]) => {
      const text = msgs.map(m => m.text).join('\n\n');
      const firstMsg = msgs[0];
      
      return new JournalEntry({
        chatId: firstMsg.chatId,
        date,
        period,
        text,
        source: EntrySource.TEXT,
        createdAt: firstMsg.timestamp,
      });
    });
  }

  // ==================== Serialization ====================

  /**
   * Convert to plain object
   * @returns {object}
   */
  toJSON() {
    return {
      uuid: this.#uuid,
      chatId: this.#chatId,
      date: this.#date,
      period: this.#period,
      text: this.#text,
      source: this.#source,
      transcription: this.#transcription,
      analysis: this.#analysis ? { ...this.#analysis } : null,
      createdAt: this.#createdAt,
    };
  }

  /**
   * Create from plain object
   * @param {object} data
   * @returns {JournalEntry}
   */
  static from(data) {
    return new JournalEntry(data);
  }
}

export default JournalEntry;
