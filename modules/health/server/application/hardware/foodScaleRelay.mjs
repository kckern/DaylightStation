// backend/src/3_applications/hardware/foodScaleRelay.mjs
//
// Food-scale relay wiring — two independent handlers on the event bus:
//
//   1) INGEST  (client → bus): the ESP32 kitchen relay (see
//      _extensions/kitchen-relay) connects to the WS event bus as a device
//      client and streams decoded weight/button events. We re-broadcast them on
//      the scale's configured topic (default `food-scale`) so any app/display
//      can subscribe live.
//
//   2) PERSIST (bus → disk): a subscriber records only MEANINGFUL events to
//      {dataDir}/{persistence.dir}/{id}/{YYYY-MM-DD}.yml
//      (default dir: household/nutrition/log). Two kinds of records:
//        - settled measurements: a stable, non-empty weight, recorded once and
//          not repeated until the value changes or the pan is emptied (so the
//          scale resting on its side on the shelf isn't logged over and over).
//        - button presses: force-capture the live weight at that instant
//          (settled or not) — pressing the button IS the "log this now" gesture.
//      The raw ~4 Hz stream stays ephemeral on the bus; we never persist it.
//
// Config-driven: the persistence root and per-scale broadcast topics come from
// the household SSOT (config/scales.yml), passed in as `config`. The two
// concerns are decoupled: persistence policy can change without touching the
// relay firmware or the ingest path.
//
// Design: docs/plans/2026-07-10-food-scale-relay-design.md

// Ingest discriminators we accept. `kitchen-relay` is the unified kitchen board
// (_extensions/kitchen-relay), which carries the scale AND the DS2278 scanner and
// so emits scale/button/scan under ONE source, discriminated by `type`.
// `food-scale-relay` is the legacy per-board source, kept so a backend deploy and
// a reflash can happen in either order.
//
// A `type:'scan'` message from the kitchen board reaches this handler too and
// falls out of the bottom untouched — barcodeRelay.mjs owns it. That is the whole
// contract between the two handlers: same source, disjoint `type` sets.
// Persistence policy tuning is injected as resolved values.
// - emptyThresholdG: at/below this the pan is considered empty → a fresh
//   measurement session may begin (re-arms dedup so an identical next weight
//   still records).
// - dedupDeltaG: a settled reading is only recorded if it differs from the last
//   RECORDED value by at least this much. Kills the shelf-rest spam: the scale
//   stored on its side holds a steady load and, on every BLE reconnect blip,
//   used to re-record that same weight forever.
const DEFAULT_EMPTY_THRESHOLD_G = 2;
const DEFAULT_DEDUP_DELTA_G = 2;

/**
 * @param {object}   deps
 * @param {object}   deps.relayGateway semantic scale relay gateway
 * @param {number}   [deps.emptyThresholdG]
 * @param {number}   [deps.dedupDeltaG]
 * @param {string}   [deps.timezone] IANA tz for the `ts` field + day-file bucket (default household tz)
 * @param {object}   [deps.logger]  structured logger
 * @returns {{ dispose: () => void }}
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
export function createFoodScaleRelay({
  relayGateway, dayLog, emptyThresholdG = DEFAULT_EMPTY_THRESHOLD_G,
  dedupDeltaG = DEFAULT_DEDUP_DELTA_G, logger = console,
}) {
  if (!relayGateway?.subscribe) {
    throw new Error('createFoodScaleRelay: relayGateway required');
  }

  emptyThresholdG = Number(emptyThresholdG);
  dedupDeltaG = Number(dedupDeltaG);
  // ---- 2) PERSIST: bus → disk (settled measurements + buttons) ------------
  // Per-scale state:
  //  - lastReading:      most recent decoded frame (settled OR not) — lets a
  //                      button press capture the weight at that exact moment.
  //  - lastRecordedGrams:the value of the last SETTLED reading we wrote. A held
  //                      value (shelf rest) is recorded once and never again
  //                      until it changes or the pan is emptied — reconnect
  //                      blips no longer re-record it.
  const lastReading = new Map();       // id -> { grams, unit, stable }
  const lastRecordedGrams = new Map(); // id -> number

  // Serialize all appends through one promise chain: the day-log append is a
  // read-modify-write, so concurrent calls (e.g. a button right after a settle)
  // would otherwise clobber each other's list.
  let writeChain = Promise.resolve();
  const enqueueAppend = (id, record) => {
    writeChain = writeChain
      .then(() => dayLog.append(id, record))
      .catch((err) => logger.warn?.('food_scale.persist.failed', { id, error: err.message }));
  };

  const onPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';

    // Button press → force-capture the live weight at this instant, settled or
    // not. Pressing the button IS the "log this now" gesture.
    if (payload.event === 'button') {
      const record = { ts: payload.ts, event: 'button', press: payload.press };
      const live = lastReading.get(id);
      if (live) { record.grams = live.grams; record.unit = live.unit; record.stable = live.stable; }
      enqueueAppend(id, record);
      return;
    }

    const grams = Number(payload.grams);
    if (!Number.isFinite(grams)) return;
    const unit = payload.unit || 'g';
    const stable = Boolean(payload.stable);
    lastReading.set(id, { grams, unit, stable });

    if (grams <= emptyThresholdG) {
      lastRecordedGrams.delete(id);          // pan emptied → next placement is a fresh session
      return;
    }
    if (!stable) return;                     // wobble / reconnect blip → don't record, don't re-arm

    const prev = lastRecordedGrams.get(id);
    if (prev != null && Math.abs(grams - prev) < dedupDeltaG) return; // same held value → skip
    lastRecordedGrams.set(id, grams);
    enqueueAppend(id, { ts: payload.ts, grams, unit, kind: 'settled' });
  };

  const unsubscribe = relayGateway.subscribe(onPayload);

  logger.info?.('food_scale.relay.ready');
  return { dispose: () => { try { unsubscribe?.(); } catch { /* noop */ } } };
}


export default createFoodScaleRelay;
