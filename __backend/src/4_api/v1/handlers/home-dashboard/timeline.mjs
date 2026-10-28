/**
 * Home Dashboard Timeline Handlers
 * @module api/handlers/home-dashboard/timeline
 *
 * GET /api/v1/home-dashboard/timeline?range=today|yesterday|week
 * GET /api/v1/home-dashboard/entities/:entityId/history?range=24h|7d
 * Range validation and the 400/404 mapping live in the use cases (semantic
 * errors reach the error middleware); these handlers only pass through.
 */

/**
 * @param {Object} deps
 * @param {Object} deps.operation - GetHomeTimeline use case
 * @returns {Function} Express handler
 */
export function homeDashboardTimelineHandler({ operation } = {}) {
  if (!operation) throw new Error('homeDashboardTimelineHandler: operation required');
  return async (req, res) => {
    const range = req.query?.range || 'today';
    const result = await operation.execute({ range });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  };
}

/**
 * @param {Object} deps
 * @param {Object} deps.operation - GetEntityHistory use case
 * @returns {Function} Express handler
 */
export function homeDashboardEntityHistoryHandler({ operation } = {}) {
  if (!operation) throw new Error('homeDashboardEntityHistoryHandler: operation required');
  return async (req, res) => {
    const range = req.query?.range || '24h';
    const result = await operation.execute({ entityId: req.params.entityId, range });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  };
}
