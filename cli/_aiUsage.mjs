/**
 * AI usage ledger for CLIs — the same monthly JSONL trail the app writes
 * (`<dataDir>/system/history/ai-usage/`), under its own writer file (`source:
 * 'cli'`, i.e. `YYYY-MM.cli.jsonl`) so a CLI never appends to the file the
 * running server owns.
 */
import path from 'node:path';
import { createAiUsageLedger } from '#adapters/ai/AiUsageLedger.mjs';

export const CLI_LEDGER_SOURCE = 'cli';

/** @param {string} dataDir - `configService.getDataDir()` */
export function aiUsageDirFor(dataDir) {
  return path.join(dataDir, 'system', 'history', 'ai-usage');
}

/**
 * @param {Object} configService - anything with getDataDir()
 * @param {Object} [logger]
 */
export function createCliAiUsageLedger(configService, logger = null) {
  return createAiUsageLedger({ dir: aiUsageDirFor(configService.getDataDir()), source: CLI_LEDGER_SOURCE, logger });
}

/** Attribution for a CLI's AI calls: its app, feature `cli`. */
export function cliUsageTags(app) {
  return { app, feature: 'cli' };
}
