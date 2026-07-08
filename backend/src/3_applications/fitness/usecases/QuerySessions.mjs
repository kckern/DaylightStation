/**
 * QuerySessions — list-sessions use case.
 *
 * Absorbs the business logic that used to live inline in the fitness API
 * router's `GET /sessions` handler:
 *   - single-date listing (backwards-compat "date" mode)
 *   - date-range listing ("since" mode) with relative-date parsing ("30d")
 *   - the session-enrichment merge (grouping via SessionGroupingService)
 *   - sort (descending by startTime) and limit slicing
 *
 * Response shapes are preserved EXACTLY (the frontend consumes them). The
 * router stays thin: it maps query params in, and either serializes the
 * returned body or, when the use case returns null, responds 400.
 */

/**
 * Resolve the `since` query token into a concrete start-date string.
 *
 * Supported form:
 *   - relative days: "30d" -> the date N days before `now` (YYYY-MM-DD)
 *
 * Any other value (an absolute "YYYY-MM-DD", or an unrecognized token such as
 * "2w") is passed through unchanged — matching the historical router behavior,
 * where only the `/^(\d+)d$/` pattern was expanded and everything else was
 * handed to the store as-is.
 *
 * @param {string} since - the raw `since` query value
 * @param {Object} [opts]
 * @param {Date}   [opts.now] - reference "today" (defaults to new Date())
 * @returns {string} the resolved start-date (YYYY-MM-DD for relative forms,
 *                   otherwise the input unchanged)
 */
export function resolveStartDate(since, { now = new Date() } = {}) {
  const relMatch = typeof since === 'string' ? since.match(/^(\d+)d$/) : null;
  if (relMatch) {
    const d = new Date(now.getTime());
    d.setDate(d.getDate() - parseInt(relMatch[1], 10));
    return d.toISOString().split('T')[0];
  }
  return since;
}

export class QuerySessions {
  #sessionService;
  #sessionGroupingService;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.sessionService - SessionService (listSessionsByDate,
   *   listSessionsInRange, resolveHouseholdId)
   * @param {Object} [deps.sessionGroupingService] - SessionGroupingService for
   *   the enrichment/grouping merge (optional; when absent, grouping is skipped)
   * @param {Object} [deps.logger]
   */
  constructor({ sessionService, sessionGroupingService = null, logger = console } = {}) {
    if (!sessionService) throw new Error('QuerySessions: sessionService required');
    this.#sessionService = sessionService;
    this.#sessionGroupingService = sessionGroupingService;
    this.#logger = logger;
  }

  /**
   * Execute the query.
   *
   * @param {Object} params
   * @param {string} [params.date] - single-date mode (YYYY-MM-DD)
   * @param {string} [params.since] - date-range mode (YYYY-MM-DD or "30d")
   * @param {string|number} [params.limit] - max sessions in `since` mode (default 20)
   * @param {string} [params.household]
   * @param {string} [params.group] - when 'none', suppresses grouping
   * @returns {Promise<Object|null>} the response body, or null when neither
   *   `date` nor `since` was supplied (router should reply 400)
   */
  async execute({ date, since, limit, household, group } = {}) {
    const doGroup = this.#sessionGroupingService && group !== 'none';

    // Mode 1: Single date query (backwards compat)
    if (date && !since) {
      let sessions = await this.#sessionService.listSessionsByDate(date, household);
      if (doGroup) sessions = await this.#sessionGroupingService.group(sessions, household);
      return {
        sessions,
        date,
        household: this.#sessionService.resolveHouseholdId(household)
      };
    }

    // Mode 2: Date range query (since -> today)
    if (since) {
      const t0 = Date.now();
      const endDate = new Date().toISOString().split('T')[0]; // Today
      // Parse relative date notation (e.g. "30d" = 30 days ago)
      const startDate = resolveStartDate(since);
      let sessions = await this.#sessionService.listSessionsInRange(startDate, endDate, household);
      const tAfterList = Date.now();
      if (doGroup) sessions = await this.#sessionGroupingService.group(sessions, household);
      const tAfterGroup = Date.now();
      sessions.sort((a, b) => b.startTime - a.startTime); // grouping returns ascending; list is desc
      const maxLimit = parseInt(limit) || 20;
      const limited = sessions.slice(0, maxLimit);

      this.#logger.info?.('fitness.sessions.range.timing', {
        since,
        startDate,
        endDate,
        total: sessions.length,
        returned: limited.length,
        grouped: Boolean(doGroup),
        listMs: tAfterList - t0,
        groupMs: tAfterGroup - tAfterList,
        totalMs: Date.now() - t0
      });

      return {
        sessions: limited,
        since,
        endDate,
        total: sessions.length,
        returned: limited.length,
        household: this.#sessionService.resolveHouseholdId(household)
      };
    }

    // Neither date nor since provided.
    return null;
  }
}

export default QuerySessions;
