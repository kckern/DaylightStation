// Pressure-mat relay wiring — writes step/stomp events to append-only history.
//
// 1) INGEST (already handled by PressureMatAdapter): the board publishes
//    `presence` messages on the configured `pressure-mat` topic.
//
// 2) PERSIST (bus-side): this subscriber appends only transition events to
//    {dataDir}/{persistence.dir}/{id}/{YYYY-MM-DD}.yml with keys matching
//    OMR/scale history conventions:
//      - pressed
//      - stomped
//      - released
//
// History is local-day bucketed by timestamp and uses append-only read-modify-write
// arrays to keep one list per mat per day.
import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { formatLocalTimestamp, getDateInTimezone } from '#domains/core/utils/time.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

const RELAY_SOURCE = 'pressure-mat-relay';
const VALID_EVENTS = new Set(['pressed', 'stomped', 'released']);
const DEFAULT_TOPIC = 'pressure-mat';
const DEFAULT_DIR = 'household/pressure-mats/log'; // relative to dataDir

/**
 * @param {object}   deps
 * @param {object}   deps.eventBus   IEventBus (WebSocketEventBus)
 * @param {string}   deps.dataDir    resolved data dir (configService.getDataDir())
 * @param {object}   [deps.config]   parsed pressure-mats.yml — { pressure_mats:{<id>:{topic}}, persistence:{dir} }
 * @param {string}   [deps.timezone] IANA tz for `ts` + day bucket (default household tz)
 * @param {object}   [deps.logger]
 * @returns {{ dispose: () => void, flush: () => Promise<void> }}
 */
export function createPressureMatRelay({ eventBus, dataDir, config = {}, timezone = DEFAULT_TIMEZONE, logger = console }) {
  if (!eventBus?.subscribe) {
    throw new Error('createPressureMatRelay: eventBus with subscribe required');
  }
  if (!dataDir) {
    logger.info?.('pressure_mat.relay.ready', { persist: false });
    return { dispose: () => {}, flush: () => Promise.resolve() };
  }

  const matDefs = config?.pressure_mats || {};
  const persistDir = (config?.persistence?.dir || DEFAULT_DIR).replace(/^\/+/, '');
  const historyRoot = path.join(dataDir, ...persistDir.split('/'));
  const topics = new Set([DEFAULT_TOPIC, ...Object.values(matDefs).map((m) => m?.topic).filter(Boolean)]);

  let writeChain = Promise.resolve();
  const enqueueAppend = (id, record) => {
    writeChain = writeChain
      .then(() => appendRecord(historyRoot, id, record, timezone, logger))
      .catch((err) => logger.warn?.('pressure_mat.persist.failed', { id, error: err.message }));
  };

  const onPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.source !== RELAY_SOURCE || payload.type !== 'presence') return;

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

  const unsubs = [...topics].map((topic) => eventBus.subscribe(topic, onPayload));
  logger.info?.('pressure_mat.relay.ready', { historyRoot, topics: [...topics] });

  return {
    dispose: () => {
      for (const unsubscribe of unsubs) {
        try { unsubscribe?.(); } catch { /* noop */ }
      }
    },
    flush: () => writeChain,
  };
}

/** Append one record to the mat's append-only day log (read-modify-write). */
async function appendRecord(historyRoot, id, record, timezone, logger) {
  const day = (typeof record?.ts === 'string' && /^\d{4}-\d{2}-\d{2}/.test(record.ts))
    ? record.ts.slice(0, 10)
    : getDateInTimezone(new Date(), timezone);
  const dir = path.join(historyRoot, sanitize(id));
  const file = path.join(dir, `${day}.yml`);
  await fs.mkdir(dir, { recursive: true });

  let list = [];
  try {
    const existing = yaml.load(await fs.readFile(file, 'utf8'));
    if (Array.isArray(existing)) list = existing;
  } catch (err) {
    if (err.code !== 'ENOENT') logger.warn?.('pressure_mat.persist.read_failed', { file, error: err.message });
  }

  list.push(record);
  await fs.writeFile(file, yaml.dump(list, { indent: 2, lineWidth: -1, noRefs: true }), 'utf8');
  logger.debug?.('pressure_mat.persist.wrote', { id, event: record.event, steps: record.steps, stomps: record.stomps });
}

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

export default createPressureMatRelay;
