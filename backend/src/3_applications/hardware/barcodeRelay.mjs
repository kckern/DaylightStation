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
//   2) PERSIST: a subscriber appends every scan through an injected semantic
//      day-log repository. The adapter owns the concrete storage layout.
//
// Decoupled + unit-tested like foodScaleRelay.mjs.

// Ingest discriminators we accept, which is NOT the same set as the one value we
// re-broadcast. Two boards can feed this handler:
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
/**
 * @param {object}   deps
 * @param {object}   deps.relayGateway        semantic barcode relay gateway
 * @param {Function} [deps.onScan]            optional (payload) => void — e.g. BarcodeScanService dispatch
 * @param {string}   [deps.defaultDevice]     device id when the relay omits one
 * @param {string}   [deps.defaultRoute]      route when the relay omits one (content|nutribot)
 * @param {boolean}  [deps.persistenceEnabled] whether scan history is retained
 * @param {object}   [deps.dayLog]            append-only day-log store, injected (D5)
 * @param {string}   [deps.timezone]          IANA tz for the `ts` field + day-file bucket (default household tz)
 * @param {object}   [deps.logger]
 * @returns {{ dispose: () => void }}
 */
export function createBarcodeRelay({
  relayGateway,
  onScan = null,
  defaultDevice = 'barcode-relay',
  defaultRoute = 'content',
  persistenceEnabled = true,
  dayLog,
  logger = console,
}) {
  if (!relayGateway?.subscribe) {
    throw new Error('createBarcodeRelay: relayGateway required');
  }

  // ---- 2) PERSIST: bus → disk (every scan) -------------------------------
  let writeChain = Promise.resolve();
  const unsubscribe = relayGateway.subscribe((payload) => {
    logger.info?.('barcode_relay.scan', { device: payload.device, code: payload.code });
    if (typeof onScan === 'function') {
      try { onScan(payload); } catch (err) { logger.warn?.('barcode_relay.onScan.failed', { error: err.message }); }
    }
    if (!persistenceEnabled) return;
    const device = payload.device || defaultDevice;
    writeChain = writeChain.then(() => dayLog.append(device, { ts: payload.ts, code: payload.code }))
      .catch((err) => logger.warn?.('barcode_relay.persist.failed', { device, error: err.message }));
  });
  if (persistenceEnabled) {

    // Serialize appends: the day-log append is a read-modify-write, so back-to-back
    // scans would otherwise clobber each other's day list.
    logger.info?.('barcode_relay.ready', {});
  } else {
    logger.info?.('barcode_relay.ready', { persist: false });
  }

  return { dispose: () => { try { unsubscribe?.(); } catch { /* noop */ } } };
}

export default createBarcodeRelay;
