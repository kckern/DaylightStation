// backend/src/3_applications/hardware/foodScaleRelay.mjs
//
// Food-scale relay wiring — two independent handlers on the event bus:
//
//   1) INGEST  (client → bus): the ESP32 food-scale-relay (see
//      _extensions/food-scale-relay) connects to the WS event bus as a device
//      client and streams decoded weight/button events. We re-broadcast them on
//      the scale's configured topic (default `food-scale`) so any app/display
//      can subscribe live.
//
//   2) PERSIST (bus → disk): a subscriber records only MEANINGFUL events to
//      {dataDir}/{persistence.dir}/{id}/{YYYY-MM-DD}.yml
//      (default dir: household/history/nutrition). Two kinds of records:
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
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const RELAY_SOURCE = 'food-scale-relay';
const DEFAULT_TOPIC = 'food-scale';
const DEFAULT_DIR = 'household/history/nutrition'; // relative to dataDir

// Persistence policy tuning (overridable via config.persistence).
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
 * @param {object}   deps.eventBus  IEventBus (WebSocketEventBus)
 * @param {string}   deps.dataDir   resolved data dir (configService.getDataDir())
 * @param {object}   [deps.config]  parsed config/scales.yml — { persistence:{dir}, scales:{<id>:{topic}} }
 * @param {object}   [deps.logger]  structured logger
 * @returns {{ dispose: () => void }}
 */
export function createFoodScaleRelay({ eventBus, dataDir, config = {}, logger = console }) {
  if (!eventBus?.onClientMessage || !eventBus?.subscribe) {
    throw new Error('createFoodScaleRelay: eventBus with onClientMessage + subscribe required');
  }

  const scaleDefs = config?.scales || {};
  const emptyThresholdG = Number(config?.persistence?.emptyThresholdG ?? DEFAULT_EMPTY_THRESHOLD_G);
  const dedupDeltaG = Number(config?.persistence?.dedupDeltaG ?? DEFAULT_DEDUP_DELTA_G);
  const persistDir = (config?.persistence?.dir || DEFAULT_DIR).replace(/^\/+/, '');
  const historyRoot = path.join(dataDir, ...persistDir.split('/'));
  const topicForId = (id) => scaleDefs[id]?.topic || DEFAULT_TOPIC;
  // Every distinct topic we must persist from (default + any per-scale overrides).
  const topics = new Set([DEFAULT_TOPIC, ...Object.values(scaleDefs).map((s) => s?.topic).filter(Boolean)]);

  // ---- 1) INGEST: relay device client → bus ------------------------------
  eventBus.onClientMessage((clientId, message) => {
    if (!message || message.source !== RELAY_SOURCE) return;
    const id = typeof message.id === 'string' && message.id ? message.id : 'unknown';
    const ts = new Date().toISOString();
    const topic = topicForId(id);

    if (message.type === 'scale') {
      const grams = Number(message.grams);
      if (!Number.isFinite(grams)) {
        logger.warn?.('food_scale.ingest.bad_weight', { clientId, id });
        return;
      }
      eventBus.broadcast(topic, {
        id,
        grams,
        stable: Boolean(message.stable),
        unit: message.unit || 'g',
        ts,
        source: 'ble-relay',
      });
      return;
    }

    if (message.type === 'button') {
      eventBus.broadcast(topic, {
        id,
        event: 'button',
        press: message.press === 'long' ? 'long' : 'short',
        ts,
      });
      return;
    }
  });

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

  // Serialize all appends through one promise chain: appendRecord is a
  // read-modify-write, so concurrent calls (e.g. a button right after a settle)
  // would otherwise clobber each other's list.
  let writeChain = Promise.resolve();
  const enqueueAppend = (id, record) => {
    writeChain = writeChain
      .then(() => appendRecord(historyRoot, id, record, logger))
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

  const unsubs = [...topics].map((topic) => eventBus.subscribe(topic, onPayload));

  logger.info?.('food_scale.relay.ready', { historyRoot, topics: [...topics] });
  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

/** Append one record to the scale's append-only day log (read-modify-write). */
async function appendRecord(historyRoot, id, record, logger) {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const dir = path.join(historyRoot, id);
  const file = path.join(dir, `${day}.yml`);
  await fs.mkdir(dir, { recursive: true });

  let list = [];
  try {
    const existing = yaml.load(await fs.readFile(file, 'utf8'));
    if (Array.isArray(existing)) list = existing;
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn?.('food_scale.persist.read_failed', { file, error: err.message });
  }

  list.push(record);
  await fs.writeFile(file, yaml.dump(list, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8');
  logger.debug?.('food_scale.persist.wrote', { id, kind: record.kind || record.event });
}

export default createFoodScaleRelay;
