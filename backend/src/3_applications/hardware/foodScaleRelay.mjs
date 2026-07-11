// backend/src/3_applications/hardware/foodScaleRelay.mjs
//
// Food-scale relay wiring — two independent handlers on the event bus:
//
//   1) INGEST  (client → bus): the ESP32 food-scale-relay (see
//      _extensions/food-scale-relay) connects to the WS event bus as a device
//      client and streams decoded weight/button events. We re-broadcast them on
//      the `food-scale` topic so any app/display can subscribe live.
//
//   2) PERSIST (bus → disk): a subscriber records only MEANINGFUL events —
//      settled weight measurements and button presses — to
//      data/household/history/hardware/food-scale/{id}/{YYYY-MM-DD}.yml. The
//      raw ~4 Hz stream stays ephemeral on the bus; we never persist it.
//
// The two concerns are decoupled: persistence policy (sampling, format,
// retention) can change without touching the relay firmware or the ingest path.
//
// Design: docs/plans/2026-07-10-food-scale-relay-design.md
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const RELAY_SOURCE = 'food-scale-relay';
const TOPIC = 'food-scale';

/**
 * @param {object}   deps
 * @param {object}   deps.eventBus  IEventBus (WebSocketEventBus)
 * @param {string}   deps.dataDir   resolved data dir (configService.getDataDir())
 * @param {object}   [deps.logger]  structured logger
 * @returns {{ dispose: () => void }}
 */
export function createFoodScaleRelay({ eventBus, dataDir, logger = console }) {
  if (!eventBus?.onClientMessage || !eventBus?.subscribe) {
    throw new Error('createFoodScaleRelay: eventBus with onClientMessage + subscribe required');
  }

  const historyDir = path.join(dataDir, 'household', 'history', 'hardware', 'food-scale');

  // ---- 1) INGEST: relay device client → bus ------------------------------
  eventBus.onClientMessage((clientId, message) => {
    if (!message || message.source !== RELAY_SOURCE) return;
    const id = typeof message.id === 'string' && message.id ? message.id : 'unknown';
    const ts = new Date().toISOString();

    if (message.type === 'scale') {
      const grams = Number(message.grams);
      if (!Number.isFinite(grams)) {
        logger.warn?.('food_scale.ingest.bad_weight', { clientId, id });
        return;
      }
      eventBus.broadcast(TOPIC, {
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
      eventBus.broadcast(TOPIC, {
        id,
        event: 'button',
        press: message.press === 'long' ? 'long' : 'short',
        ts,
      });
      return;
    }
  });

  // ---- 2) PERSIST: bus → disk (settled measurements + buttons only) -------
  // Per-scale latch so a held-steady reading is recorded ONCE per settle cycle,
  // not on every heartbeat frame. Re-arms when the scale goes changing or to 0.
  const latched = new Map(); // id -> boolean

  // Serialize all appends through one promise chain: appendRecord is a
  // read-modify-write, so concurrent calls (e.g. a button right after a settle)
  // would otherwise clobber each other's list.
  let writeChain = Promise.resolve();
  const enqueueAppend = (id, record) => {
    writeChain = writeChain
      .then(() => appendRecord(historyDir, id, record, logger))
      .catch((err) => logger.warn?.('food_scale.persist.failed', { id, error: err.message }));
  };

  const unsubscribe = eventBus.subscribe(TOPIC, (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';

    let record = null;
    if (payload.event === 'button') {
      record = { ts: payload.ts, event: 'button', press: payload.press };
    } else {
      const grams = Number(payload.grams);
      const settled = payload.stable && Number.isFinite(grams) && grams > 0;
      if (settled) {
        if (latched.get(id)) return;         // already recorded this settle
        latched.set(id, true);
        record = { ts: payload.ts, grams, unit: payload.unit || 'g', kind: 'settled' };
      } else {
        latched.set(id, false);              // re-arm on change / zero
        return;
      }
    }

    enqueueAppend(id, record);
  });

  logger.info?.('food_scale.relay.ready', { historyDir });
  return { dispose: () => { try { unsubscribe?.(); } catch { /* noop */ } } };
}

/** Append one record to the scale's append-only day log (read-modify-write). */
async function appendRecord(historyDir, id, record, logger) {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const dir = path.join(historyDir, id);
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
