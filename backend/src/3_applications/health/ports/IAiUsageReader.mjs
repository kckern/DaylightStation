/**
 * IAiUsageReader — read access to the AI usage ledger for spend reports.
 *
 * @typedef {Object} AiUsageRow
 * @property {string} ts - ISO timestamp of the call
 * @property {boolean} attributed - false for rows written before the ledger
 *   carried attribution (no `app` field at all). Such rows cannot be split by
 *   app; `app: null` on an attributed row means the caller was not scoped.
 * @property {string|null} app
 * @property {string|null} feature
 * @property {string|null} agentId
 * @property {string|null} model
 * @property {number|null} costUsd
 * @property {string|null} status - 'ok' | 'error'
 * @property {number} [audioSeconds]
 * @property {number} [characters]
 */
export class IAiUsageReader {
  /**
   * Ledger rows with `ts` in [from, to), every writer's file.
   * @param {{ from: string, to: string, app?: string|null }} query - `app`
   *   omitted = every row; a string or null narrows to that app.
   * @returns {Promise<AiUsageRow[]>}
   */
  async listRows(_query) { throw new Error('IAiUsageReader.listRows must be implemented'); }
}

/** Does `reader` look like an IAiUsageReader? */
export function isAiUsageReader(reader) {
  return typeof reader?.listRows === 'function';
}

export default IAiUsageReader;
