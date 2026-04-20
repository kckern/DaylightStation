/**
 * Home Dashboard History Handler
 * @module api/handlers/home-dashboard/history
 *
 * GET /api/v1/home-dashboard/history
 * Returns downsampled history time-series for chart entities.
 *
 * The `?hours=...` query param is accepted as a hint but v1 uses
 * the hour ranges defined in YAML config; the use case ignores the hint.
 */

/**
 * Create home-dashboard history handler
 * @param {Object} deps
 * @param {Object} deps.container - HomeAutomationContainer
 * @param {Object} [deps.logger]
 * @returns {Function} Express handler
 */
export function homeDashboardHistoryHandler({ container, logger = console }) {
  return async (_req, res) => {
    const result = await container.getDashboardHistory().execute();
    res.json(result);
  };
}

export default homeDashboardHistoryHandler;
