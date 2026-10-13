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
 * @param {Object} deps.operation - ActivateDashboardScene use case
 * @param {Object} [deps.logger]
 * @returns {Function} Express handler
 */
export function homeDashboardSceneHandler({ operation }) {
  return async (req, res) => {
    const { sceneId } = req.params;
    const result = await operation.execute({ sceneId });
    res.json(result);
  };
}

export default homeDashboardSceneHandler;
