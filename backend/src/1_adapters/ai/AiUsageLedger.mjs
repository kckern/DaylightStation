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
import { appendTextFile, listFiles, readTextFromPathAsync } from '#system/utils/FileIO.mjs';

const MONTH_FILE = /^(\d{4})-(\d{2})(?:\.[\w.-]+)?\.jsonl$/;

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

    /**
     * One agent's recorded costs with `ts` in [from, to), from every writer's
     * month files. Spend caps read this rather than their own records, so a
     * turn that failed after it was billed still counts. Malformed lines skip.
     * @returns {Promise<Array<{ts: string, costUsd: number}>>}
     */
    async listCosts({ agentId, from, to }) {
      const fromMs = Date.parse(from);
      const toMs = Date.parse(to);
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new Error('listCosts needs an ISO from and to');
      const files = listFiles(dir).filter((name) => {
        const m = MONTH_FILE.exec(name);
        return m && Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) < toMs && Date.UTC(Number(m[1]), Number(m[2]), 1) > fromMs;
      });
      const rows = [];
      for (const name of files) {
        for (const raw of (await readTextFromPathAsync(path.join(dir, name))).split('\n')) {
          if (!raw.trim()) continue;
          let row;
          try { row = JSON.parse(raw); } catch { continue; }
          const t = Date.parse(row?.ts);
          if (row?.agentId !== agentId || !Number.isFinite(t) || t < fromMs || t >= toMs || !Number.isFinite(row.costUsd)) continue;
          rows.push({ ts: row.ts, costUsd: row.costUsd });
        }
      }
      return rows;
    },
  };
}

export default { createAiUsageLedger };
