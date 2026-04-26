/**
 * Home Dashboard Scene Handler
 * @module api/handlers/home-dashboard/scene
 *
 * POST /api/v1/home-dashboard/scene/:sceneId
 * Activates a whitelisted scene via the Home Automation gateway.
 */

/**
 * Create home-dashboard scene handler
 * @param {Object} deps
 * @param {Object} deps.container - HomeAutomationContainer
 * @param {Object} [deps.logger]
 * @returns {Function} Express handler
 */
export function homeDashboardSceneHandler({ container, logger = console }) {
  return async (req, res) => {
    const { sceneId } = req.params;
    const result = await container.activateDashboardScene().execute({ sceneId });
    res.json(result);
  };
}

export default homeDashboardSceneHandler;
