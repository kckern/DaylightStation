// Shared input-telemetry gate + sender, reused across piano input modes
// (SheetMusic, Composer). Recording into the ring buffer is always on (cheap);
// draining batches to the backend is gated on household config opting in, and
// each mode tags its batches/headers with its own app id on the 'input' channel.
import getLogger from './Logger.js';

/**
 * Pure gate for input-telemetry SHIPPING, scoped to ONE mode. True when the
 * top-level flag opts in (`config.inputTelemetry.enabled`) OR the flag nested
 * under THIS mode does (`config[mode].inputTelemetry.enabled`).
 *
 * The `mode` param is what keeps Composer's opt-in from arming SheetMusic (and
 * vice-versa): SheetMusic's ScorePlayer passes the FULL piano config with
 * mode 'sheetmusic', while Composer's EditorSurface passes only its `.composer`
 * subtree with mode 'composer'. Without the mode scope, a single
 * `composer.inputTelemetry` in piano.yml matched both call sites and shipped
 * SheetMusic unasked.
 *
 * @param {object} config the config object handed to the mode (full piano
 *   config for SheetMusic, the `.composer` subtree for Composer).
 * @param {string} mode which mode is asking — 'composer' or 'sheetmusic'.
 */
export function inputTelemetryEnabled(config, mode) {
  return !!(config?.inputTelemetry?.enabled || (mode && config?.[mode]?.inputTelemetry?.enabled));
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
