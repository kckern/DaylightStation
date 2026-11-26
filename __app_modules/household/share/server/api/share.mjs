/**
 * Share API (mounted at /api/v1/share) — anything shared from the phone.
 *
 *   POST /text                 a share (the shared text, as a quick input of kind text) for the default target
 *   POST /to/:target/text      the same, for one configured target (one route per target)
 *   GET  /targets              { defaultTarget, targets: [{ id, label }] }
 *   GET  /jobs/:id             what a started share is doing (the screen's intro polls this)
 *
 * The POST routes are the shared quick-input route: they guard themselves
 * (origin, device binding, allowance) and app.mjs keeps the app-wide CORS and
 * body parsers off their exact paths (shareIntakePaths).
 *
 * Reference: __docs/reference/core/share.md
 */
import express from 'express';
import { quickInputRoute, quickInputPreflight } from '../../../../../__capabilities/quick-input/server/api.mjs';

export function createShareRouter({ endpoints, policy, router: shareRouter, logger = console }) {
  if (!endpoints?.byTarget || !shareRouter) throw new Error('createShareRouter requires endpoints and the share router');
  const router = express.Router();
  const route = (target) => ({ kind: 'text', logger, naming: { logContext: { bot: 'share', kind: 'text', target } } });

  router.options('/text', quickInputPreflight(route(policy.defaultTarget)));
  router.post('/text', ...quickInputRoute(endpoints.default, route(policy.defaultTarget)));
  for (const [target, endpoint] of endpoints.byTarget) {
    router.options(`/to/${target}/text`, quickInputPreflight(route(target)));
    router.post(`/to/${target}/text`, ...quickInputRoute(endpoint, route(target)));
  }

  router.get('/targets', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ defaultTarget: policy.defaultTarget, targets: policy.targets });
  });

  router.get('/jobs/:id', (req, res) => {
    const id = String(req.params.id);
    if (!/^s[0-9a-f]{12}$/.test(id)) return res.status(400).json({ error: 'bad job id' });
    const status = shareRouter.status(id);
    res.set('Cache-Control', 'no-store');
    if (!status) return res.status(404).json({ state: 'gone' });
    return res.json(status);
  });

  return router;
}

export default createShareRouter;
