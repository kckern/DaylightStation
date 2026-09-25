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
import { appendTextFile, readDirectoryAsync, readTextFromPathAsync } from '#system/utils/FileIO.mjs';

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

  /** Parsed rows with `ts` in [from, to) from every writer's month files. */
  async function readRange(from, to) {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) throw new Error('the ledger needs an ISO from and to');
    let names;
    try { names = await readDirectoryAsync(dir); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const files = names.filter((name) => {
      const m = MONTH_FILE.exec(name);
      return m && Date.UTC(Number(m[1]), Number(m[2]) - 1, 1) < toMs && Date.UTC(Number(m[1]), Number(m[2]), 1) > fromMs;
    });
    const rows = [];
    for (const name of files) {
      for (const raw of (await readTextFromPathAsync(path.join(dir, name))).split('\n')) {
        if (!raw.trim()) continue;
        let row;
        try { row = JSON.parse(raw); } catch { continue; }
        if (!row || typeof row !== 'object') continue;
        const t = Date.parse(row.ts);
        if (!Number.isFinite(t) || t < fromMs || t >= toMs) continue;
        rows.push(row);
      }
    }
    return rows;
  }

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
     * @param {string|null} [entry.app] - App the spend belongs to ('health',
     *   'journalist', …), from the caller's scoped gateway view or the agent
     *   map. null = untagged.
     * @param {string|null} [entry.feature] - Feature within the app
     *   ('photo-log', 'auditor', …). null = no feature.
     * @param {string|null} [entry.origin] - Entry point the call ran under
     *   ('http:POST /api/v1/…', 'job:<id>', 'telegram:<bot>', 'tick:…',
     *   'cli:<name>'). Informational, for finding untagged callers; never
     *   used as attribution.
     * @param {string} [entry.agentId] - Mastra agent rows only
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
     * Recorded costs with `ts` in [from, to), from every writer's month
     * files, narrowed by whichever of `agentId`, `app`, `feature` are given
     * (omitted = any; `null` = rows without that field). Spend caps read this
     * rather than their own records, so a turn that failed after it was
     * billed still counts. Malformed lines and rows without a cost skip.
     * @param {Object} query
     * @param {string} query.from - ISO start (inclusive)
     * @param {string} query.to - ISO end (exclusive)
     * @param {string|null} [query.agentId]
     * @param {string|null} [query.app]
     * @param {string|null} [query.feature]
     * @returns {Promise<Array<{ts: string, costUsd: number, agentId: string|null, app: string|null, feature: string|null}>>}
     */
    async listCosts({ agentId, app, feature, from, to }) {
      const wants = Object.entries({ agentId, app, feature }).filter(([, value]) => value !== undefined);
      const rows = [];
      for (const row of await readRange(from, to)) {
        if (wants.some(([field, value]) => (row[field] ?? null) !== value)) continue;
        if (!Number.isFinite(row.costUsd)) continue;
        rows.push({ ts: row.ts, costUsd: row.costUsd, agentId: row.agentId ?? null, app: row.app ?? null, feature: row.feature ?? null });
      }
      return rows;
    },

    /**
     * IAiUsageReader: every row with `ts` in [from, to), priced or not,
     * optionally narrowed to one app (`null` = unscoped rows). `attributed`
     * is false for rows written before the ledger carried an `app` field.
     */
    async listRows({ from, to, app }) {
      const rows = [];
      for (const row of await readRange(from, to)) {
        if (app !== undefined && (row.app ?? null) !== app) continue;
        rows.push({
          ts: row.ts,
          attributed: Object.hasOwn(row, 'app'),
          app: row.app ?? null,
          feature: row.feature ?? null,
          agentId: row.agentId ?? null,
          model: row.model ?? null,
          costUsd: Number.isFinite(row.costUsd) ? row.costUsd : null,
          status: row.status ?? null,
          ...(Number.isFinite(row.audioSeconds) ? { audioSeconds: row.audioSeconds } : {}),
          ...(Number.isFinite(row.characters) ? { characters: row.characters } : {}),
        });
      }
      return rows;
    },
  };
}

export default { createAiUsageLedger };
