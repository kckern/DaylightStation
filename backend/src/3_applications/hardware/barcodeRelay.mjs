// backend/src/3_applications/hardware/barcodeRelay.mjs
//
// Ingest for the ESP32 barcode-relay (a Zebra DS2278 bridged over BLE HID —
// see _extensions/barcode-relay). The relay connects to the WS event bus as a
// device client and sends one message per completed scan:
//   { source: 'barcode-relay', type: 'scan', device: '<id>', code: '<barcode>', ts: <ms> }
//
// We re-broadcast on the `barcode-relay` topic (any app can subscribe live) and,
// when a barcode pipeline is wired, hand the scan to the existing BarcodeScanService
// (gatekeeper → queue/play/open) so BLE scans behave exactly like the USB scanner.
//
// Decoupled + unit-tested like foodScaleRelay.mjs.
const RELAY_SOURCE = 'barcode-relay';
const TOPIC = 'barcode-relay';

/**
 * @param {object}   deps
 * @param {object}   deps.eventBus            IEventBus (WebSocketEventBus)
 * @param {Function} [deps.onScan]            optional (payload) => void — e.g. BarcodeScanService.handle
 * @param {string}   [deps.defaultDevice]     device id when the relay omits one
 * @param {object}   [deps.logger]
 * @returns {{ dispose: () => void }}
 */
export function createBarcodeRelay({ eventBus, onScan = null, defaultDevice = 'barcode-relay', logger = console }) {
  if (!eventBus?.onClientMessage || !eventBus?.broadcast) {
    throw new Error('createBarcodeRelay: eventBus with onClientMessage + broadcast required');
  }

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

  logger.info?.('barcode_relay.ready', {});
  return { dispose: () => {} };
}

export default createBarcodeRelay;
