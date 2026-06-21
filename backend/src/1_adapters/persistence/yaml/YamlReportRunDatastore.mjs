/**
 * YamlReportRunDatastore
 *
 * YAML-based run-history store for the newsreporter framework. Implements the
 * IReportRunHistory port: records the outcome of one reporter run for
 * observability.
 *
 * Household path: history/newsreporter/{reporterId}/{date}
 * (DataService auto-appends the .yml extension). The {date} is the calendar
 * date derived from runResult.startedAt (the run's start instant), so all
 * runs for a given day land in one file.
 *
 * Recording must NEVER throw into the run path — a failed write is logged
 * (newsreporter.history.write_failed) and swallowed.
 *
 * @module adapters/persistence/yaml/YamlReportRunDatastore
 */

import { IReportRunHistory } from '#apps/newsreporter/ports/IReportRunHistory.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const HISTORY_BASE = 'history/newsreporter';

export class YamlReportRunDatastore extends IReportRunHistory {
  #dataService;
  #logger;

  /**
   * @param {{ dataService: object, logger?: object }} deps
   */
  constructor({ dataService, logger = console } = {}) {
    super();
    if (!dataService) {
      throw new InfrastructureError('YamlReportRunDatastore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService',
      });
    }
    this.#dataService = dataService;
    this.#logger = logger;
  }

  /**
   * Record one reporter run outcome. Never throws.
   * @param {string} reporterId
   * @param {{ startedAt?: string, status?: string, sourceCounts?: object, sinkResults?: Array, error?: any }} runResult
   * @returns {Promise<void>}
   */
  async record(reporterId, runResult = {}) {
    const date = calendarDate(runResult.startedAt);
    const path = `${HISTORY_BASE}/${reporterId}/${date}`;
    const payload = {
      startedAt: runResult.startedAt ?? null,
      status: runResult.status ?? null,
      sourceCounts: runResult.sourceCounts ?? {},
      sinkResults: runResult.sinkResults ?? [],
      error: runResult.error ?? null,
    };

    try {
      this.#dataService.household.write(path, payload);
      this.#logger.debug?.('newsreporter.history.recorded', { reporterId, date, status: payload.status });
    } catch (err) {
      this.#logger.warn?.('newsreporter.history.write_failed', {
        reporterId,
        date,
        error: err?.message || String(err),
      });
    }
  }
}

/**
 * Derive a YYYY-MM-DD calendar date from an ISO startedAt timestamp.
 * Falls back to the current UTC date if startedAt is missing/unparseable.
 * @param {string} [startedAt]
 * @returns {string} YYYY-MM-DD
 */
function calendarDate(startedAt) {
  const d = startedAt ? new Date(startedAt) : new Date();
  const valid = Number.isFinite(d.getTime()) ? d : new Date();
  return valid.toISOString().slice(0, 10);
}

export default YamlReportRunDatastore;
