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
 * @param {Object} deps.operation - GetDashboardHistory use case
 * @param {Object} [deps.logger]
 * @returns {Function} Express handler
 */
export function homeDashboardHistoryHandler({ operation }) {
  return async (_req, res) => {
    const result = await operation.execute();
    res.json(result);
  };
}

export default homeDashboardHistoryHandler;
