/**
 * GitHub Lifelog Extractor
 * 
 * Extracts code activity from github.yml
 * Structure: Array with 'date' string field
 */

import moment from 'moment';

export const githubExtractor = {
  source: 'github',
  category: 'work',
  filename: 'github',
  
  /**
   * Extract GitHub activity for a specific date
   * @param {Array} data - Full github.yml data (array)
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Array|null} Array of activities or null
   */
  extractForDate(data, date) {
    if (!Array.isArray(data)) return null;
    
    const items = data.filter(e => e.date === date).map(e => ({
      type: e.type,
      repo: e.repo?.split('/')[1] || e.repo, // Just repo name without owner
      fullRepo: e.repo,
      sha: e.sha,
      message: e.message,
      fullMessage: e.fullMessage,
      time: moment(e.createdAt).format('h:mm A'),
      url: e.url
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
    
    const commits = entries.filter(e => e.type === 'commit');
    if (!commits.length) return null;
    
    const repos = [...new Set(commits.map(c => c.repo))];
    const lines = [`GITHUB COMMITS (${commits.length}) to ${repos.join(', ')}:`];
    
    commits.forEach(c => {
      lines.push(`  - ${c.time}: "${c.message}"`);
    });
    
    return lines.join('\n');
  }
};

export default githubExtractor;
