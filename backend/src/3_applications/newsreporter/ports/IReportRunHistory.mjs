/**
 * @interface IReportRunHistory
 *
 * Persists the outcome of a reporter run for observability. Implementations
 * live in 1_adapters (e.g. a yaml datastore). Recording must never throw into
 * the run path.
 */
export class IReportRunHistory {
  /**
   * @param {string} reporterId
   * @param {object} runResult { startedAt, status, sourceCounts, sinkResults, error }
   * @returns {Promise<void>}
   */
  async record(reporterId, runResult) {
    throw new Error('IReportRunHistory.record must be implemented');
  }
}

export function isReportRunHistory(obj) {
  return !!obj && typeof obj.record === 'function';
}
