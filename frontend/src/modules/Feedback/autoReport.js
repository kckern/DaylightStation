import { submitFeedback } from './feedbackApi.js';
import getLogger, { getConfig } from '../../lib/logging/Logger.js';

/**
 * autoReport — let a broken kiosk file its own feedback item.
 *
 * The voice-feedback pipeline produced the only complete durable record of the
 * 2026-08-16 remount storm, and it did so because it depends on none of the
 * machinery that failed: the 300-event ring in Logger.js is independent of every
 * transport, gate, level filter and pruner, and FeedbackService stores what
 * arrives verbatim and indefinitely. Audio is optional there
 * (`hasAudio = !!(audioBuffer && audioBuffer.length)`, everything downstream
 * null-safe), so a machine-generated "I noticed I was stuck" report rides the
 * same POST, the same YAML and the same 150-event snapshot with `audio: null`.
 * No backend change was needed for any of this.
 *
 * The one rule that matters: ONE report per incident. A detector that files 495
 * reports during a storm is a second incident, and it buries the first. Three
 * brakes enforce that — a per-key cooldown, an explicit dedupe key so two
 * different crash sites are two incidents, and a hard per-page-load cap that no
 * combination of reasons can exceed.
 */

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'auto-report' });
  return _logger;
}

/**
 * Default quiet period per incident key. Long enough that a stall which flaps
 * for a quarter of an hour files once, short enough that a fresh occurrence
 * after the house has moved on is still recorded.
 */
export const AUTO_REPORT_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Hard ceiling per page load, across all reasons. The cooldown alone would not
 * have held on 2026-08-16: the remount storm changed identity ~480 times in
 * three minutes, so anything keyed on the failing item would have looked like
 * hundreds of distinct incidents.
 */
export const AUTO_REPORT_MAX_PER_SESSION = 5;

const lastFiledAt = new Map();
let filedThisSession = 0;

/** Test seam — clears the dedupe memory and the per-session counter. */
export function resetAutoReportState() {
  lastFiledAt.clear();
  filedThisSession = 0;
}

/**
 * File a machine-generated feedback item.
 *
 * Never throws and never rejects: it is called from error boundaries, watchdogs
 * and render-adjacent loops, where a telemetry failure must not become the
 * user-visible failure.
 *
 * @param {object} p
 * @param {string} [p.app] - feedback app slug; falls back to the app the logger
 *        was configured with, and the call is skipped when neither exists (an
 *        untagged surface would file into a directory nobody triages).
 * @param {string} p.reason - what noticed, e.g. 'stall-detector'
 * @param {object} [p.detail] - anything worth having at triage time
 * @param {string} [p.dedupeKey] - distinguishes incidents sharing a reason
 * @param {number} [p.cooldownMs=AUTO_REPORT_COOLDOWN_MS]
 * @returns {Promise<object|null>} the created item, or null when not filed
 */
export async function autoReport({
  app,
  reason,
  detail = {},
  dedupeKey,
  cooldownMs = AUTO_REPORT_COOLDOWN_MS,
} = {}) {
  let resolvedApp = app;
  if (!resolvedApp) {
    try { resolvedApp = getConfig()?.context?.app || null; } catch { resolvedApp = null; }
  }
  if (!resolvedApp) {
    logger().debug('auto-report.skipped-no-app', { reason });
    return null;
  }

  const key = `${resolvedApp}:${reason}:${dedupeKey || ''}`;
  const now = Date.now();
  const last = lastFiledAt.get(key);
  if (typeof last === 'number' && now - last < cooldownMs) {
    logger().debug('auto-report.deduped', { app: resolvedApp, reason, sinceMs: now - last });
    return null;
  }
  if (filedThisSession >= AUTO_REPORT_MAX_PER_SESSION) {
    logger().debug('auto-report.capped', { app: resolvedApp, reason, cap: AUTO_REPORT_MAX_PER_SESSION });
    return null;
  }

  try {
    const item = await submitFeedback({
      app: resolvedApp,
      blob: null,
      durationMs: 0,
      context: { auto: true, reason, ...detail },
    });
    // Claim the slot only on success. A report lost to a dead network should be
    // retriable on the next tick, which is precisely when the network is worth
    // retrying — the failure that prompted the report may be the same one.
    lastFiledAt.set(key, now);
    filedThisSession += 1;
    logger().warn('auto-report.filed', { app: resolvedApp, reason, id: item?.id ?? null });
    return item;
  } catch (error) {
    logger().warn('auto-report.failed', { app: resolvedApp, reason, error: String(error?.message ?? error) });
    return null;
  }
}

export default autoReport;
