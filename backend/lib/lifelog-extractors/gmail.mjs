/**
 * Gmail Lifelog Extractor
 * 
 * Extracts email activity from gmail.yml (date-keyed structure)
 * Lifelog contains: sent emails + received emails still in inbox at harvest time
 */

export const gmailExtractor = {
  source: 'gmail',
  category: 'communication',
  filename: 'gmail',
  
  /**
   * Extract email activity for a specific date
   * @param {Object} data - Full gmail.yml data (date-keyed: { '2025-12-30': [...], ... })
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Object|null} Extracted data or null
   */
  extractForDate(data, date) {
    // Handle both old format (array) and new format (date-keyed object)
    if (Array.isArray(data)) {
      // Old format - filter by date field
      const dayMessages = data.filter(m => m.date === date);
      if (!dayMessages.length) return null;
      return {
        sent: dayMessages.filter(m => m.isSent),
        received: dayMessages.filter(m => !m.isSent),
        total: dayMessages.length
      };
    }
    
    // New date-keyed format
    const dayMessages = data?.[date];
    if (!Array.isArray(dayMessages) || !dayMessages.length) return null;
    
    return {
      sent: dayMessages.filter(m => m.category === 'sent' || m.isSent),
      received: dayMessages.filter(m => m.category === 'received' || (!m.isSent && m.category !== 'sent')),
      total: dayMessages.length
    };
  },

  /**
   * Format extracted data as human-readable summary
   * @param {Object} entry - Extracted data
   * @returns {string|null} Formatted summary or null
   */
  summarize(entry) {
    if (!entry || entry.total === 0) return null;
    
    const lines = ['EMAIL ACTIVITY:'];
    
    if (entry.sent.length) {
      lines.push(`  Sent ${entry.sent.length} email${entry.sent.length > 1 ? 's' : ''}:`);
      entry.sent.slice(0, 5).forEach(m => {
        const recipient = m.to?.split('<')[0]?.trim() || m.to || 'Unknown';
        lines.push(`    - To: ${recipient} - "${m.subject}"`);
      });
      if (entry.sent.length > 5) {
        lines.push(`    ... and ${entry.sent.length - 5} more`);
      }
    }
    
    if (entry.received.length) {
      lines.push(`  Received ${entry.received.length} important email${entry.received.length > 1 ? 's' : ''} (still in inbox):`);
      entry.received.slice(0, 3).forEach(m => {
        const sender = m.from?.split('<')[0]?.trim() || m.from || 'Unknown';
        lines.push(`    - From: ${sender} - "${m.subject}"`);
      });
      if (entry.received.length > 3) {
        lines.push(`    ... and ${entry.received.length - 3} more`);
      }
    }
    
    return lines.join('\n');
  }
};

export default gmailExtractor;
