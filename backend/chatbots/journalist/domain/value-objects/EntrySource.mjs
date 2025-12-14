/**
 * EntrySource Value Object
 * @module journalist/domain/value-objects/EntrySource
 * 
 * Defines the source/input method of journal entries.
 */

/**
 * @enum {string}
 */
export const EntrySource = Object.freeze({
  TEXT: 'text',
  VOICE: 'voice',
  CALLBACK: 'callback',
  SYSTEM: 'system',
});

/**
 * All valid entry sources
 * @type {string[]}
 */
export const ALL_ENTRY_SOURCES = Object.freeze(Object.values(EntrySource));

/**
 * Check if a value is a valid entry source
 * @param {string} source
 * @returns {boolean}
 */
export function isValidEntrySource(source) {
  return ALL_ENTRY_SOURCES.includes(source);
}

/**
 * Get emoji for entry source
 * @param {string} source
 * @returns {string}
 */
export function entrySourceEmoji(source) {
  const emojis = {
    [EntrySource.TEXT]: '📝',
    [EntrySource.VOICE]: '🎤',
    [EntrySource.CALLBACK]: '👆',
    [EntrySource.SYSTEM]: '🤖',
  };
  return emojis[source] || '📝';
}

/**
 * Get description for entry source
 * @param {string} source
 * @returns {string}
 */
export function entrySourceDescription(source) {
  const descriptions = {
    [EntrySource.TEXT]: 'Text message',
    [EntrySource.VOICE]: 'Voice message (transcribed)',
    [EntrySource.CALLBACK]: 'Button/keyboard selection',
    [EntrySource.SYSTEM]: 'System-generated',
  };
  return descriptions[source] || 'Unknown source';
}

export default EntrySource;
