/**
 * AiUsageLedger — durable, append-only record of every AI API call.
 *
 * The log store keeps seven days; billing questions outlive that, so each
 * call is also appended to a monthly JSONL file under
 * `<dataDir>/system/history/ai-usage/YYYY-MM.jsonl`.
 *
 * Recording must never break the call it observes: every failure is caught
 * and logged, and record() resolves regardless. Appends are serialized
 * through a queue so concurrent calls cannot interleave partial lines.
 */

import path from 'path';
import { appendTextFile } from '#system/utils/FileIO.mjs';

/**
 * @param {Object} config
 * @param {string} config.dir - Directory for the monthly JSONL files
 * @param {string} [config.source] - Writer identity (env/hostname) baked into
 *   the filename. The data tree is Dropbox-synced; prod and a dev machine
 *   appending to the SAME file is the two-writer conflict that plagued
 *   backend.log, so each writer gets its own file.
 * @param {Object} [config.logger]
 */
export function createAiUsageLedger({ dir, source = null, logger = null }) {
  let tail = Promise.resolve();

  return {
    /**
     * @param {Object} entry
     * @param {string} entry.provider - 'openai' | 'anthropic'
     * @param {string} entry.endpoint - API endpoint path
     * @param {string} [entry.model] - Model that answered
     * @param {string} [entry.requestedModel] - Model the caller asked for
     * @param {number} [entry.promptTokens]
     * @param {number} [entry.completionTokens]
     * @param {number} [entry.totalTokens]
     * @param {number|null} [entry.costUsd]
     * @param {number} [entry.durationMs]
     * @param {'ok'|'error'} [entry.status]
     * @param {number} [entry.httpStatus]
     * @param {string} [entry.error]
     * @returns {Promise<void>} resolves once the append settles (never rejects)
     */
    record(entry) {
      const ts = new Date().toISOString();
      const line = `${JSON.stringify({ ts, ...entry })}\n`;
      const suffix = source ? `.${String(source).replace(/[^\w.-]+/g, '-')}` : '';
      const file = path.join(dir, `${ts.slice(0, 7)}${suffix}.jsonl`);
      tail = tail
        .then(() => appendTextFile(file, line))
        .catch((error) => {
          logger?.warn?.('ai.usage.ledger-write-failed', { file, error: error.message });
        });
      return tail;
    },
  };
}

export default { createAiUsageLedger };
