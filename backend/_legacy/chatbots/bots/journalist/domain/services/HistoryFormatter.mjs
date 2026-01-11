/**
 * HistoryFormatter Domain Service
 * @module journalist/domain/services/HistoryFormatter
 * 
 * Formats conversation history for various purposes.
 */

/**
 * Format messages as a chat transcript
 * @param {import('../entities/ConversationMessage.mjs').ConversationMessage[]} messages
 * @returns {string}
 */
export function formatAsChat(messages) {
  return messages.map(msg => {
    const datetime = new Date(msg.timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    return `[${datetime}] ${msg.senderName}: ${msg.text}`;
  }).join('\n');
}

/**
 * Truncate history to max length, preserving recent messages
 * @param {string} history - Formatted history string
 * @param {number} maxLength - Maximum character length
 * @returns {string}
 */
export function truncateToLength(history, maxLength) {
  if (history.length <= maxLength) {
    return history;
  }

  // Truncate from beginning, keeping most recent
  const truncated = history.slice(-maxLength);
  
  // Find first complete line
  const firstNewline = truncated.indexOf('\n');
  if (firstNewline > 0 && firstNewline < truncated.length - 100) {
    return '...\n' + truncated.slice(firstNewline + 1);
  }

  return '...' + truncated;
}

/**
 * Build chat context for AI (messages array format)
 * @param {import('../entities/ConversationMessage.mjs').ConversationMessage[]} messages
 * @param {string} [botName='Journalist']
 * @returns {Array<{role: string, content: string}>}
 */
export function buildChatContext(messages, botName = 'Journalist') {
  return messages.map(msg => ({
    role: msg.isFromBot(botName) ? 'assistant' : 'user',
    content: msg.text,
  }));
}

/**
 * Get recent messages within a time window
 * @param {import('../entities/ConversationMessage.mjs').ConversationMessage[]} messages
 * @param {number} hoursAgo - Hours to look back
 * @returns {import('../entities/ConversationMessage.mjs').ConversationMessage[]}
 */
export function getRecentMessages(messages, hoursAgo = 24) {
  const cutoff = Date.now() - (hoursAgo * 60 * 60 * 1000);
  return messages.filter(msg => new Date(msg.timestamp).getTime() > cutoff);
}

/**
 * Group messages by date
 * @param {import('../entities/ConversationMessage.mjs').ConversationMessage[]} messages
 * @returns {Map<string, import('../entities/ConversationMessage.mjs').ConversationMessage[]>}
 */
export function groupByDate(messages) {
  const groups = new Map();
  
  for (const msg of messages) {
    const date = msg.timestamp.split('T')[0];
    if (!groups.has(date)) {
      groups.set(date, []);
    }
    groups.get(date).push(msg);
  }
  
  return groups;
}

/**
 * Extract user text only (for analysis)
 * @param {import('../entities/ConversationMessage.mjs').ConversationMessage[]} messages
 * @param {string} [botName='Journalist']
 * @returns {string}
 */
export function extractUserText(messages, botName = 'Journalist') {
  return messages
    .filter(msg => !msg.isFromBot(botName))
    .map(msg => msg.text)
    .join('\n\n');
}

export default {
  formatAsChat,
  truncateToLength,
  buildChatContext,
  getRecentMessages,
  groupByDate,
  extractUserText,
};
