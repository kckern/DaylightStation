/**
 * GitHub Lifelog Extractor
 *
 * Extracts code activity from github.yml
 * Structure: Array with 'date' string field
 *
 * @module applications/lifelog/extractors
 */

import moment from 'moment';
import { ILifelogExtractor, ExtractorCategory } from "../../application/ports/ILifelogExtractor.mjs";

/**
 * GitHub activity extractor
 * @implements {ILifelogExtractor}
 */
export class GithubExtractor extends ILifelogExtractor {
  get source() {
    return 'github';
  }

  get category() {
    return ExtractorCategory.PRODUCTIVITY;
  }

  get filename() {
    return 'github';
  }

  /**
   * Extract GitHub activity for a specific date
   * @param {Array} data - Full github.yml data (array)
   * @param {string} date - Target date 'YYYY-MM-DD'
   * @returns {Array|null} Array of activities or null
   */
  extractForDate(data, date) {
    if (!Array.isArray(data)) return null;

    const items = data
      .filter((e) => e.date === date)
      .map((e) => ({
        type: e.type,
        repo: e.repo?.split('/')[1] || e.repo, // Just repo name without owner
        fullRepo: e.repo,
        sha: e.sha,
        message: e.message,
        fullMessage: e.fullMessage,
        time: moment(e.createdAt).format('h:mm A'),
        url: e.url,
      }));

    return items.length ? items : null;
  }

  /**
   * Format extracted data as human-readable summary
   * @param {Array} entries - Extracted activities
   * @returns {string|null} Formatted summary or null
   */
  summarize(entries) {
    if (!entries?.length) return null;

    const commits = entries.filter((e) => e.type === 'commit');
    if (!commits.length) return null;

    // Most commits are made by AI coding agents running in the background, so
    // commit times say when an agent finished, not when the user was working.
    // Report WHAT moved per project, with no clock times, so the debrief can't
    // read a 50-commit day as "coding until midnight".
    const agentCount = commits.filter((c) => isAgentCommit(c)).length;
    const byRepo = new Map();
    for (const c of commits) {
      if (!byRepo.has(c.repo)) byRepo.set(c.repo, []);
      byRepo.get(c.repo).push(c.message);
    }

    const lines = [
      `GITHUB (what moved, not time spent): ${commits.length} commits, ${agentCount} made by AI coding agents running in the background. Commit times are omitted on purpose; they do not show when the user was working.`,
    ];
    for (const [repo, messages] of byRepo) {
      lines.push(`  ${repo} (${messages.length}):`);
      for (const m of messages) lines.push(`    - ${m}`);
    }

    return lines.join('\n');
  }
}

/** A commit co-authored by an AI coding agent (Claude, Codex, Copilot...). */
export function isAgentCommit(commit) {
  return /co-authored-by:[^\n]*(claude|anthropic|openai|codex|copilot|cursor|gemini)/i.test(
    commit?.fullMessage || '',
  );
}

// Export singleton instance for backward compatibility
export const githubExtractor = new GithubExtractor();

export default GithubExtractor;
