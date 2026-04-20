/**
 * Home Dashboard State Handler
 * @module api/handlers/home-dashboard/state
 *
 * GET /api/v1/home-dashboard/state
 * Returns the composed dashboard state (rooms + entities + live values).
 */

/**
 * Create home-dashboard state handler
 * @param {Object} deps
 * @param {Object} deps.container - HomeAutomationContainer
 * @param {Object} [deps.logger]
 * @returns {Function} Express handler
 */
export function homeDashboardStateHandler({ container, logger = console }) {
  return async (_req, res) => {
    const result = await container.getDashboardState().execute();
    res.json(result);
  };
}

export default homeDashboardStateHandler;
