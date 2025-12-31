/**
 * PromptType Value Object
 * @module journalist/domain/value-objects/PromptType
 * 
 * Defines the types of prompts used in journalist conversations.
 */

/**
 * @enum {string}
 */
export const PromptType = Object.freeze({
  BIOGRAPHER: 'biographer',
  AUTOBIOGRAPHER: 'autobiographer',
  MULTIPLE_CHOICE: 'multiple_choice',
  EVALUATE_RESPONSE: 'evaluate_response',
  THERAPIST_ANALYSIS: 'therapist_analysis',
  CONVERSATIONAL: 'conversational',
  CONVERSATIONAL_CHOICES: 'conversational_choices',
});

/**
 * All valid prompt types
 * @type {string[]}
 */
export const ALL_PROMPT_TYPES = Object.freeze(Object.values(PromptType));

/**
 * Check if a value is a valid prompt type
 * @param {string} type
 * @returns {boolean}
 */
export function isValidPromptType(type) {
  return ALL_PROMPT_TYPES.includes(type);
}

/**
 * Get description for a prompt type
 * @param {string} type
 * @returns {string}
 */
export function promptTypeDescription(type) {
  const descriptions = {
    [PromptType.BIOGRAPHER]: 'Generate follow-up questions from user journal entry',
    [PromptType.AUTOBIOGRAPHER]: 'Generate opening/initiating questions for journaling',
    [PromptType.MULTIPLE_CHOICE]: 'Generate multiple choice options for a question',
    [PromptType.EVALUATE_RESPONSE]: 'Evaluate if response allows continuing question queue',
    [PromptType.THERAPIST_ANALYSIS]: 'Deep analysis of journal entries for insights',
  };
  return descriptions[type] || 'Unknown prompt type';
}

/**
 * Get emoji for a prompt type
 * @param {string} type
 * @returns {string}
 */
export function promptTypeEmoji(type) {
  const emojis = {
    [PromptType.BIOGRAPHER]: '📖',
    [PromptType.AUTOBIOGRAPHER]: '📘',
    [PromptType.MULTIPLE_CHOICE]: '🎯',
    [PromptType.EVALUATE_RESPONSE]: '🔍',
    [PromptType.THERAPIST_ANALYSIS]: '🧠',
  };
  return emojis[type] || '📝';
}

export default PromptType;
