// Nutriboat /webhook handler
// Responsibility: receive inbound events (e.g., chat platform callbacks) and enqueue/process
// Export a default async function(req, res)
import { logger } from '../../_lib/logging.mjs';

export default async function nutribotWebhookHandler(req, res) {
  const log = logger.child({ bot: 'nutribot', route: 'webhook', traceId: req.traceId });
  // For now just echo payload size and keys
  const body = req.body || {};
  log.info('webhook.received', { keys: Object.keys(body), size: JSON.stringify(body).length });
  res.json({ ok: true, receivedKeys: Object.keys(body), traceId: req.traceId });
}
