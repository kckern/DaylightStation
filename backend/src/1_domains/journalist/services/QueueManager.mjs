/**
 * QueueManager Domain Service
 * @module journalist/domain/services/QueueManager
 *
 * Manages the message queue for conversation flow.
 */

import { MessageQueue } from '../entities/MessageQueue.mjs';
import { ValidationError } from '../../core/errors/index.mjs';

/**
 * Check if response allows continuing the queue
 * @param {string} evalResult - AI evaluation result
 * @returns {boolean}
 */
export function shouldContinueQueue(evalResult) {
  if (!evalResult) return false;
  // AI returns "1" for continue, "0" for don't continue
  return /1/gi.test(evalResult);
}

/**
 * Get the next unsent queue item
 * @param {MessageQueue[]} queue - Queue items
 * @returns {MessageQueue|null}
 */
export function getNextUnsent(queue) {
  if (!queue || queue.length === 0) return null;
  return queue.find((item) => !item.isSent()) || null;
}

/**
 * Prepare next queue item with choices
 * @param {MessageQueue[]} queue
 * @param {string[][]} choices
 * @returns {{ item: MessageQueue, remaining: number }|null}
 */
export function prepareNextQueueItem(queue, choices) {
  const nextItem = getNextUnsent(queue);
  if (!nextItem) return null;

  const remaining = queue.filter((item) => !item.isSent()).length - 1;
  const preparedItem = nextItem.withChoices(choices);

  return {
    item: preparedItem,
    remaining,
  };
}

/**
 * Format question with prefix emoji
 * @param {string} text - Question text
 * @param {string} [prefix='⏩'] - Prefix emoji
 * @returns {string}
 */
export function formatQuestion(text, prefix = '⏩') {
  if (!text) return '';

  // Clean up leading non-alphanumeric
  const cleaned = text.replace(/^[^a-zA-Z0-9]+/, '').trim();

  return `${prefix} ${cleaned}`;
}

/**
 * Format choices as keyboard with number emojis
 * @param {string[]} choices - Array of choice strings
 * @param {boolean} [addControls=true] - Add Change Subject and Cancel buttons
 * @returns {string[][]} Keyboard layout
 */
export function formatChoicesAsKeyboard(choices, addControls = true) {
  if (!Array.isArray(choices) || choices.length === 0) {
    return buildDefaultChoices();
  }

  const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const keyboard = choices.slice(0, 5).map((c, i) => [`${numberEmojis[i]} ${c}`]);

  if (addControls) {
    keyboard.push(['🎲 Change Subject', '❌ Cancel']);
  }

  return keyboard;
}

/**
 * Build default choices for questions
 * @returns {string[][]}
 */
export function buildDefaultChoices() {
  return [['🎲 Change Subject', '❌ Cancel']];
}

/**
 * Create a queue from questions
 * @param {string} chatId
 * @param {string[]} questions
 * @param {object} [foreignKey]
 * @param {string} timestamp - ISO timestamp (required, from application layer)
 * @returns {MessageQueue[]}
 */
export function createQueueFromQuestions(chatId, questions, foreignKey = {}, timestamp) {
  if (!timestamp) {
    throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
  }
  return questions.map((question, index) =>
    MessageQueue.create({
      chatId,
      timestamp,
      queuedMessage: question,
      foreignKey: { ...foreignKey, queueIndex: index },
    }),
  );
}

/**
 * Get unsent count
 * @param {MessageQueue[]} queue
 * @returns {number}
 */
export function getUnsentCount(queue) {
  if (!queue) return 0;
  return queue.filter((item) => !item.isSent()).length;
}

/**
 * Mark item as sent and return updated queue
 * @param {MessageQueue[]} queue
 * @param {string} uuid
 * @param {string} messageId
 * @returns {MessageQueue[]}
 */
export function markItemSent(queue, uuid, messageId) {
  return queue.map((item) => {
    if (item.uuid === uuid) {
      return item.withMessageId(messageId);
    }
    return item;
  });
}

/**
 * Clear queue (return empty array)
 * @returns {MessageQueue[]}
 */
export function clearQueue() {
  return [];
}

export default {
  shouldContinueQueue,
  getNextUnsent,
  prepareNextQueueItem,
  formatQuestion,
  formatChoicesAsKeyboard,
  buildDefaultChoices,
  createQueueFromQuestions,
  getUnsentCount,
  markItemSent,
  clearQueue,
};
