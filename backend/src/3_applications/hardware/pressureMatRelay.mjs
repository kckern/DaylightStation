// Pressure-mat relay wiring — writes step/stomp events to append-only history.
//
// 1) INGEST (already handled by PressureMatAdapter): the board publishes
//    `presence` messages on the configured `pressure-mat` topic.
//
// 2) PERSIST: this subscriber appends normalized transition events through a
//    semantic day-log repository with keys matching OMR/scale conventions:
//      - pressed
//      - stomped
//      - released
//
// History is local-day bucketed by timestamp and uses append-only read-modify-write
// arrays to keep one list per mat per day.
import { formatLocalTimestamp } from '#domains/core/utils/time.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

const VALID_EVENTS = new Set(['pressed', 'stomped', 'released']);

/**
 * @param {object}   deps
 * @param {object}   deps.pressureMatGateway semantic normalized-event gateway
 * @param {boolean}  [deps.persistenceEnabled] whether transition history is retained
 * @param {object}   deps.dayLog append-only semantic day-log repository
 * @param {string}   [deps.timezone] IANA tz for `ts` + day bucket (default household tz)
 * @param {object}   [deps.logger]
 * @returns {{ dispose: () => void, flush: () => Promise<void> }}
 */
/**
 * `dayLog` is INJECTED — an append-only day-log store (D5: data operations
 * go through datastore ports, never `fs` from the application layer).
 *
 * This relay used to hold `const DEFAULT_DIR = 'household/<domain>/log'` and
 * join it onto dataDir itself. That put storage layout in the application
 * layer, which the layer guidelines forbid outright ("Application layer never
 * builds file paths") — and it is why relocating the household tree touched
 * this file at all. The composition root resolves the location, including any
 * `persistence.dir` override, and hands down one directory.
 */
export function createPressureMatRelay({ pressureMatGateway, persistenceEnabled = true, dayLog, timezone = DEFAULT_TIMEZONE, logger = console }) {
  if (!pressureMatGateway?.subscribePresence) {
    throw new Error('createPressureMatRelay: pressureMatGateway with subscribePresence required');
  }
  if (!persistenceEnabled) {
    logger.info?.('pressure_mat.relay.ready', { persist: false });
    return { dispose: () => {}, flush: () => Promise.resolve() };
  }

  let writeChain = Promise.resolve();
  const enqueueAppend = (id, record) => {
    writeChain = writeChain
      .then(() => dayLog.append(id, record))
      .catch((err) => logger.warn?.('pressure_mat.persist.failed', { id, error: err.message }));
  };

  const onPayload = (payload) => {
    const event = payload.event;
    if (!VALID_EVENTS.has(event)) return;
    const id = payload.id || 'unknown';
    const ts = formatLocalTimestamp(new Date(payload.receivedAt || Date.now()), timezone);
    const record = {
      ts,
      event,
      occupied: Boolean(payload.occupied),
      steps: Math.max(0, Number(payload.steps) || 0),
      stomps: Math.max(0, Number(payload.stomps) || 0),
    };
    if (Number.isFinite(Number(payload.voltage))) record.voltage = Number(payload.voltage);
    if (Number.isFinite(Number(payload.deltaV))) record.delta_v = Number(payload.deltaV);
    if (Number.isFinite(Number(payload.gradientVps))) record.gradient_vps = Number(payload.gradientVps);
    if (Number.isFinite(Number(payload.deviceTs))) record.device_ts = Number(payload.deviceTs);

    enqueueAppend(id, record);
  };

  const unsubscribe = pressureMatGateway.subscribePresence(onPayload);
  logger.info?.('pressure_mat.relay.ready', {});

  return {
    dispose: () => {
      try { unsubscribe?.(); } catch { /* noop */ }
    },
    flush: () => writeChain,
  };
}

export default createPressureMatRelay;
