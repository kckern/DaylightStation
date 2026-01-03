/**
 * Journalist Messages Lifelog Extractor
 * 
 * Extracts journal entries and conversations from journalist/messages.yml
 * These are the user's own voice notes and text entries about their day
 */

export const journalistExtractor = {
  source: 'journalist',
  category: 'journal',
  filename: 'journalist/messages',
  
  /**
   * Extract journalist messages for a specific date
   * @param {Object} data - Full journalist/messages.yml data
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Object|null} Extracted messages or null
   */
  extractForDate(data, date) {
    const messages = data?.messages || [];
    
    // Filter messages for the target date
    // Timestamps are in format: '2025-12-30 23:42:43'
    const dayMessages = messages.filter(msg => {
      if (!msg.timestamp) return false;
      const msgDate = msg.timestamp.split(' ')[0]; // Extract YYYY-MM-DD
      return msgDate === date;
    });
    
    if (dayMessages.length === 0) return null;
    
    // Separate user messages from bot responses
    const userMessages = dayMessages.filter(msg => 
      msg.senderId !== 'bot' && 
      msg.role !== 'assistant' &&
      msg.content && 
      msg.content.length > 10 // Skip short responses like emoji
    );
    
    if (userMessages.length === 0) return null;
    
    return {
      messages: userMessages.map(msg => ({
        id: msg.id,
        content: msg.content,
        timestamp: msg.timestamp,
        senderName: msg.senderName
      })),
      totalMessages: userMessages.length,
      wordCount: userMessages.reduce((sum, msg) => 
        sum + (msg.content?.split(/\s+/).length || 0), 0
      )
    };
  },

  /**
   * Format extracted messages as human-readable summary
   * @param {Object} entry - Extracted data
   * @returns {string|null} Formatted summary or null
   */
  summarize(entry) {
    if (!entry || entry.messages.length === 0) return null;
    
    const lines = ['JOURNAL ENTRIES:'];
    
    // Add summary line
    lines.push(`  ${entry.totalMessages} message${entry.totalMessages > 1 ? 's' : ''} (${entry.wordCount} words)`);
    
    // Add each message with timestamp
    entry.messages.forEach(msg => {
      const time = msg.timestamp.split(' ')[1].substring(0, 5); // HH:mm
      const preview = msg.content.length > 150 
        ? msg.content.substring(0, 147) + '...'
        : msg.content;
      
      // Format as a paragraph with time prefix
      lines.push(`  [${time}] ${preview}`);
    });
    
    return lines.join('\n');
  }
};
