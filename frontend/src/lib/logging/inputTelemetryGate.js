// Shared input-telemetry gate + sender, reused across piano input modes
// (SheetMusic, Composer). Recording into the ring buffer is always on (cheap);
// draining batches to the backend is gated on household config opting in, and
// each mode tags its batches/headers with its own app id on the 'input' channel.
import getLogger from './Logger.js';

/**
 * Pure gate for input-telemetry SHIPPING. True when any of the supported config
 * shapes opts in — top-level, composer-nested, or sheetmusic-nested.
 */
export function inputTelemetryEnabled(config) {
  return !!(config?.inputTelemetry?.enabled
    || config?.composer?.inputTelemetry?.enabled
    || config?.sheetmusic?.inputTelemetry?.enabled);
}

/**
 * Build the recorder's send() for a given app. Routes each batch/header through
 * the shared logger on the 'input' channel (NO sessionLog). Exactly ONE
 * logger.info() per call ⇒ one websocket event ⇒ one backend write per drain.
 */
export function makeInputSender(app, getLoggerFn = getLogger) {
  return (payload) => getLoggerFn().info(payload.h ? 'input.header' : 'input.batch', payload, {
    context: { app, channel: 'input' },
  });
}
