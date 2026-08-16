// backend/src/3_applications/hardware/barcodeRelay.mjs
//
// Barcode relay wiring — like foodScaleRelay.mjs, two decoupled concerns on the
// event bus:
//
//   1) INGEST  (client → bus): a scanner-bearing ESP32 (see
//      _extensions/kitchen-relay and _extensions/content-barcode-relay)
//      connects to the WS event bus as a device client and sends one message per
//      completed scan:
//        { source:'kitchen-relay'|'barcode-relay', type:'scan', device:'<relay-id>', route:'content|nutribot', code:'<barcode>', ts:<ms> }
//      We re-broadcast on the `barcode-relay` topic (any app can subscribe live)
//      and, when a pipeline is wired, hand the scan to `onScan` (BarcodeScanService
//      → gatekeeper → queue/play/open) so BLE scans behave exactly like the USB scanner.
//
//   2) PERSIST (bus → disk): a subscriber appends every scan to an append-only
//      day log at {dataDir}/{persistDir}/{device}/{YYYY-MM-DD}.yml
//      (default dir: household/barcode/log) — same shape as the food-scale
//      history under household/nutrition/log/<scale>/. Persistence is enabled
//      only when a `dataDir` is supplied (unit tests omit it → no disk writes).
//
// Decoupled + unit-tested like foodScaleRelay.mjs.
import path from 'path';
import { formatLocalTimestamp, getDateInTimezone } from '#domains/core/utils/time.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

const RELAY_SOURCE = 'barcode-relay';
const TOPIC = 'barcode-relay';

// Ingest discriminators we accept, which is NOT the same set as the one value we
// re-broadcast (`RELAY_SOURCE`). Two boards can feed this handler:
//   - `kitchen-relay`  — the unified kitchen board (_extensions/kitchen-relay).
//     Scale, button AND scan all ride ONE source there, discriminated by `type`,
//     because it is one device; the `type !== 'scan'` guard below is what keeps
//     its weight stream out of this handler.
//   - `barcode-relay`  — the legacy per-board source, still emitted by
//     _extensions/content-barcode-relay.
// Accepting both is what lets the backend deploy and the reflash happen in either
// order, and what keeps the content board working when a replacement gun is
// paired to it. The BROADCAST source stays `barcode-relay` regardless: apps,
// School's VirtualScannerAdapter and the tests all key on that value, and which
// board a scan came from is already carried by `device`.
const INGEST_SOURCES = new Set([RELAY_SOURCE, 'kitchen-relay']);

/**
 * @param {object}   deps
 * @param {object}   deps.eventBus            IEventBus (WebSocketEventBus)
 * @param {Function} [deps.onScan]            optional (payload) => void — e.g. BarcodeScanService dispatch
 * @param {string}   [deps.defaultDevice]     device id when the relay omits one
 * @param {string}   [deps.defaultRoute]      route when the relay omits one (content|nutribot)
 * @param {string}   [deps.dataDir]           resolved data dir — enables disk persistence when set
 * @param {object}   [deps.dayLog]            append-only day-log store, injected (D5)
 * @param {string}   [deps.timezone]          IANA tz for the `ts` field + day-file bucket (default household tz)
 * @param {object}   [deps.logger]
 * @returns {{ dispose: () => void }}
 */
export function createBarcodeRelay({
  eventBus,
  onScan = null,
  defaultDevice = 'barcode-relay',
  defaultRoute = 'content',
  dataDir = null,
  dayLog,
  timezone = DEFAULT_TIMEZONE,
  logger = console,
}) {
  if (!eventBus?.onClientMessage || !eventBus?.broadcast) {
    throw new Error('createBarcodeRelay: eventBus with onClientMessage + broadcast required');
  }

  // ---- 1) INGEST: relay device client → bus ------------------------------
  eventBus.onClientMessage((clientId, message) => {
    if (!message || !INGEST_SOURCES.has(message.source) || message.type !== 'scan') return;

    const code = typeof message.code === 'string' ? message.code.trim() : '';
    if (!code) {
      logger.warn?.('barcode_relay.ingest.empty', { clientId });
      return;
    }
    const device = (typeof message.device === 'string' && message.device) ? message.device : defaultDevice;
    const route = (message.route === 'content' || message.route === 'nutribot') ? message.route : defaultRoute;
    // Local wall-clock timestamp (household tz), NOT UTC — matches the day-file bucket.
    const payload = { source: RELAY_SOURCE, device, route, code, ts: formatLocalTimestamp(new Date(), timezone) };

    eventBus.broadcast(TOPIC, payload);
    logger.info?.('barcode_relay.scan', { device, code });

    if (typeof onScan === 'function') {
      try { onScan(payload); }
      catch (err) { logger.warn?.('barcode_relay.onScan.failed', { error: err.message }); }
    }
  });

  // ---- 2) PERSIST: bus → disk (every scan) -------------------------------
  const unsubs = [];
  if (dataDir && eventBus.subscribe) {

    // Serialize appends: the day-log append is a read-modify-write, so back-to-back
    // scans would otherwise clobber each other's day list.
    let writeChain = Promise.resolve();
    const enqueueAppend = (device, record) => {
      writeChain = writeChain
        .then(() => dayLog.append(device, record))
        .catch((err) => logger.warn?.('barcode_relay.persist.failed', { device, error: err.message }));
    };

    unsubs.push(eventBus.subscribe(TOPIC, (payload) => {
      if (!payload || typeof payload !== 'object' || !payload.code) return;
      const device = payload.device || defaultDevice;
      enqueueAppend(device, { ts: payload.ts, code: payload.code });
    }));

    logger.info?.('barcode_relay.ready', {});
  } else {
    logger.info?.('barcode_relay.ready', { persist: false });
  }

  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

export default createBarcodeRelay;
