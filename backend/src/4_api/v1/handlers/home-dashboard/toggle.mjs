/**
 * Home Dashboard Toggle Handler
 * @module api/handlers/home-dashboard/toggle
 *
 * POST /api/v1/home-dashboard/toggle
 * Toggles a whitelisted entity's state via the Home Automation gateway.
 *
 * Accepts `entityId` + `desiredState` from body or query.
 */

import { requireParam } from '#api/utils/validation.mjs';

/**
 * Create home-dashboard toggle handler
 * @param {Object} deps
 * @param {Object} deps.container - HomeAutomationContainer
 * @param {Object} [deps.logger]
 * @returns {Function} Express handler
 */
export function homeDashboardToggleHandler({ container, logger = console }) {
  return async (req, res) => {
    const source = { ...req.query, ...req.body };
    const entityId = requireParam(source, 'entityId');
    const desiredState = requireParam(source, 'desiredState');
    const result = await container.toggleDashboardEntity().execute({ entityId, desiredState });
    res.json(result);
  };
}

export default homeDashboardToggleHandler;
