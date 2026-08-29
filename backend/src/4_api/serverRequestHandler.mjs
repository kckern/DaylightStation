import { processUptime } from '#system/runtime/processMetrics.mjs';

/** Node HTTP edge behavior for health probes and Express fall-through. */
export function createServerRequestHandler({ app, clock = Date.now, uptime = processUptime } = {}) {
  if (typeof app !== 'function') throw new Error('createServerRequestHandler requires app');
  return (req, res) => {
    if (req.url === '/healthz' || req.url === '/api/v1/health/live') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, server: 'main', timestamp: clock(), uptime: uptime() }));
      return;
    }
    return app(req, res, (error) => {
      if (res.headersSent) return;
      res.statusCode = error ? 500 : 404;
      res.end(error ? 'Internal Server Error' : 'Not Found');
    });
  };
}
