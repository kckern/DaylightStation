// backend/src/3_applications/hardware/barcodeRelay.mjs
//
// Barcode relay wiring — like foodScaleRelay.mjs, two decoupled concerns on the
// event bus:
//
//   1) INGEST  (client → bus): the ESP32 barcode-relay (a Zebra DS2278 bridged
//      over BLE HID — see _extensions/barcode-relay) connects to the WS event
//      bus as a device client and sends one message per completed scan:
//        { source:'barcode-relay', type:'scan', device:'<id>', code:'<barcode>', ts:<ms> }
//      We re-broadcast on the `barcode-relay` topic (any app can subscribe live)
//      and, when a pipeline is wired, hand the scan to `onScan` (BarcodeScanService
//      → gatekeeper → queue/play/open) so BLE scans behave exactly like the USB scanner.
//
//   2) PERSIST (bus → disk): a subscriber appends every scan to an append-only
//      day log at {dataDir}/{persistDir}/{device}/{YYYY-MM-DD}.yml
//      (default dir: household/history/barcode) — same shape as the food-scale
//      history under household/history/nutrition/<scale>/. Persistence is enabled
//      only when a `dataDir` is supplied (unit tests omit it → no disk writes).
//
// Decoupled + unit-tested like foodScaleRelay.mjs.
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const RELAY_SOURCE = 'barcode-relay';
const TOPIC = 'barcode-relay';
const DEFAULT_DIR = 'household/history/barcode'; // relative to dataDir

/**
 * @param {object}   deps
 * @param {object}   deps.eventBus            IEventBus (WebSocketEventBus)
 * @param {Function} [deps.onScan]            optional (payload) => void — e.g. BarcodeScanService dispatch
 * @param {string}   [deps.defaultDevice]     device id when the relay omits one
 * @param {string}   [deps.dataDir]           resolved data dir — enables disk persistence when set
 * @param {string}   [deps.persistDir]        history root relative to dataDir (default household/history/barcode)
 * @param {object}   [deps.logger]
 * @returns {{ dispose: () => void }}
 */
export function createBarcodeRelay({
  eventBus,
  onScan = null,
  defaultDevice = 'barcode-relay',
  dataDir = null,
  persistDir = DEFAULT_DIR,
  logger = console,
}) {
  if (!eventBus?.onClientMessage || !eventBus?.broadcast) {
    throw new Error('createBarcodeRelay: eventBus with onClientMessage + broadcast required');
  }

  // ---- 1) INGEST: relay device client → bus ------------------------------
  eventBus.onClientMessage((clientId, message) => {
    if (!message || message.source !== RELAY_SOURCE || message.type !== 'scan') return;

    const code = typeof message.code === 'string' ? message.code.trim() : '';
    if (!code) {
      logger.warn?.('barcode_relay.ingest.empty', { clientId });
      return;
    }
    const device = (typeof message.device === 'string' && message.device) ? message.device : defaultDevice;
    const payload = { source: RELAY_SOURCE, device, code, ts: new Date().toISOString() };

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
    const historyRoot = path.join(dataDir, ...String(persistDir).replace(/^\/+/, '').split('/'));

    // Serialize appends: appendRecord is a read-modify-write, so back-to-back
    // scans would otherwise clobber each other's day list.
    let writeChain = Promise.resolve();
    const enqueueAppend = (device, record) => {
      writeChain = writeChain
        .then(() => appendRecord(historyRoot, device, record, logger))
        .catch((err) => logger.warn?.('barcode_relay.persist.failed', { device, error: err.message }));
    };

    unsubs.push(eventBus.subscribe(TOPIC, (payload) => {
      if (!payload || typeof payload !== 'object' || !payload.code) return;
      const device = payload.device || defaultDevice;
      enqueueAppend(device, { ts: payload.ts, code: payload.code });
    }));

    logger.info?.('barcode_relay.ready', { historyRoot });
  } else {
    logger.info?.('barcode_relay.ready', { persist: false });
  }

  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

/** Append one scan to the device's append-only day log (read-modify-write). */
async function appendRecord(historyRoot, device, record, logger) {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const dir = path.join(historyRoot, device);
  const file = path.join(dir, `${day}.yml`);
  await fs.mkdir(dir, { recursive: true });

  let list = [];
  try {
    const existing = yaml.load(await fs.readFile(file, 'utf8'));
    if (Array.isArray(existing)) list = existing;
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn?.('barcode_relay.persist.read_failed', { file, error: err.message });
  }

  list.push(record);
  await fs.writeFile(file, yaml.dump(list, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8');
  logger.debug?.('barcode_relay.persist.wrote', { device, code: record.code });
}

export default createBarcodeRelay;
