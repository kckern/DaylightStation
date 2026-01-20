/**
 * Reddit Lifelog Extractor
 * 
 * Extracts Reddit activity from reddit.yml
 * Structure: Array with 'date' string field
 */

import moment from 'moment';

export const redditExtractor = {
  source: 'reddit',
  category: 'social',
  filename: 'reddit',
  
  /**
   * Extract Reddit activity for a specific date
   * @param {Array} data - Full reddit.yml data (array)
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Array|null} Array of activities or null
   */
  extractForDate(data, date) {
    if (!Array.isArray(data)) return null;
    
    const items = data.filter(e => e.date === date).map(e => ({
      type: e.type, // 'comment' or 'submission'
      subreddit: e.subreddit,
      body: e.body,
      linkTitle: e.linkTitle,
      score: e.score,
      time: moment(e.createdAt).format('h:mm A'),
      url: e.url,
      isNsfw: e.isNsfw
    }));
    
    return items.length ? items : null;
  },

  /**
   * Format extracted data as human-readable summary
   * @param {Array} entries - Extracted activities
   * @returns {string|null} Formatted summary or null
   */
  summarize(entries) {
    if (!entries?.length) return null;
    const lines = [`REDDIT ACTIVITY (${entries.length}):`];
    
    entries.forEach(e => {
      const context = e.linkTitle ? ` on "${e.linkTitle}"` : '';
      const score = e.score ? ` (${e.score} points)` : '';
      lines.push(`  - ${e.time} in r/${e.subreddit}${context}${score}:`);
      lines.push(`    "${e.body}"`);
    });
    
    return lines.join('\n');
  }
};

export default redditExtractor;
