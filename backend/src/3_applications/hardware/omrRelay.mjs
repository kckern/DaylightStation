// backend/src/3_applications/hardware/omrRelay.mjs
//
// OMR bubble-sheet relay wiring — two independent handlers on the event bus,
// mirroring foodScaleRelay.mjs:
//
//   1) INGEST  (client → bus): the ESP32 relay (see _extensions/omr-relay)
//      connects to the WS event bus as a device client and streams decoded
//      sheet records off a Chatsworth Data OMR-1100. We re-broadcast them on
//      the reader's configured topic (default `omr`) so any app/display can
//      subscribe live.
//
//   2) PERSIST (bus → disk): a subscriber records completed reads to
//      {dataDir}/{persistence.dir}/{id}/{YYYY-MM-DD}.yml
//      (default dir: household/hardware/omr/log).
//
// THE RELAY DOES NOT SCORE. The OMR-1100 is a read-only mark detector: it has
// no printer, no imprinter, and no grading mechanism, so it reports *which
// positions were marked* and nothing else. Mapping columns → questions →
// answers is form-specific and belongs to the consuming app (School), not here.
// Keeping that out of this layer is what lets one reader serve several form
// designs. See docs/reference/omr/README.md.
//
// Message types accepted from the relay (firmware: _extensions/omr-relay/
// firmware/src/main.cpp):
//   - `sheet`        one card: { columns, markedColumns, marks[] }, marks[] is
//                    one 12-bit mask per column, bit 0 = row 12 (far edge) …
//                    bit 11 = row 9 (strobe edge). Broadcast AND persisted.
//   - `reader-error` the reader rejected a command (`…?` echo). Broadcast and
//                    persisted — rare, and the single best diagnostic there is.
//   - `raw`          an undecodable frame, or any frame while the firmware is in
//                    SNIFF_MODE. Broadcast for live diagnostics but NEVER
//                    persisted: sniff mode is a firehose and this is a bring-up
//                    aid, not a record.
//   - `nfc`          a card tapped on the reader's optional Grove NFC unit
//                    (ST25R3916): { uid, piccType, atqa, sak }. A student
//                    announcing readiness, which downstream becomes a session
//                    start. Broadcast AND persisted, deduped per UID.
//                    Resolving uid → student is NOT this layer's job either; the
//                    same reasoning that keeps scoring out of here applies.
//
// Config-driven from the household SSOT (config/omr-readers.yml), passed in as
// `config`. Persistence policy can change without touching relay firmware.
import path from 'path';
import { formatLocalTimestamp, getDateInTimezone } from '#domains/core/utils/time.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

const RELAY_SOURCE = 'omr-relay';
const DEFAULT_TOPIC = 'omr';

// Ingest discriminators we accept. Kept as a set (rather than an equality check)
// to match the sibling relays' shape, so a future second board — or a renamed
// source during a staged reflash — is one entry rather than a refactor.
const INGEST_SOURCES = new Set([RELAY_SOURCE]);

// The reader has twelve Hollerith channels: 12, 11, 0, 1…9.
const CHANNELS = 12;
const MAX_MASK = (1 << CHANNELS) - 1;

// Retransmit suppression. The OMR-1100 has a documented `R` (retransmit)
// command that re-sends the buffer verbatim, and a card that stalls mid-feed can
// be re-fed by hand. Both produce a byte-identical record, which would grade as
// two submissions. An identical mark signature inside this window is treated as
// the same physical card. Two different students cannot plausibly hand in
// identical sheets two seconds apart; the same student re-feeding a jammed card
// absolutely can.
const DEFAULT_DEDUP_WINDOW_MS = 2000;

/**
 * @param {object}   deps
 * @param {object}   deps.eventBus   IEventBus (WebSocketEventBus)
 * @param {string}   deps.dataDir    resolved data dir (configService.getDataDir())
 * @param {object}   [deps.config]   parsed config/omr-readers.yml — { persistence:{dir,dedupWindowMs}, scanners:{<id>:{topic}} }
 * @param {string}   [deps.timezone] IANA tz for the `ts` field + day-file bucket (default household tz)
 * @param {object}   [deps.logger]   structured logger
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
export function createOmrRelay({ eventBus, dataDir, dayLog, config = {}, timezone = DEFAULT_TIMEZONE, logger = console }) {
  if (!eventBus?.onClientMessage || !eventBus?.subscribe) {
    throw new Error('createOmrRelay: eventBus with onClientMessage + subscribe required');
  }

  const readerDefs = config?.scanners || {};
  const dedupWindowMs = Number(config?.persistence?.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS);
  const topicForId = (id) => readerDefs[id]?.topic || DEFAULT_TOPIC;
  // Every distinct topic we must persist from (default + any per-reader overrides).
  const topics = new Set([DEFAULT_TOPIC, ...Object.values(readerDefs).map((r) => r?.topic).filter(Boolean)]);

  // Dedup for the BROADCAST path. The persist-path guard further down
  // (`lastNfc`) runs in `onPayload`, i.e. AFTER this broadcast has already gone
  // out — so it only ever protected the day-log. Everything that ACTS on a tap
  // (printing an agenda, opening a session) subscribes to the broadcast, which
  // is how one bouncing card produced five receipts and four sessions on
  // 2026-08-25. Keyed per reader AND uid so two different cards presented back
  // to back both get through; only a repeat of the SAME card is suppressed.
  const lastBroadcastNfc = new Map(); // `${id}::${uid}` -> atMs

  // ---- 1) INGEST: relay device client → bus ------------------------------
  eventBus.onClientMessage((clientId, message) => {
    if (!message || !INGEST_SOURCES.has(message.source)) return;
    const id = typeof message.id === 'string' && message.id ? message.id : 'unknown';
    // `ageMs` is how long the relay held this message in its outbound queue while
    // the bus was unreachable. Subtract it so the record carries WHEN THE CARD WAS
    // READ, not when the socket happened to come back. Without this, a sheet
    // queued across an outage is timestamped at delivery — and one queued across
    // midnight lands in the wrong day file, because the bucket is the ts prefix.
    const ageMs = Number(message.ageMs);
    const readAt = Number.isFinite(ageMs) && ageMs > 0
      ? new Date(Date.now() - ageMs)
      : new Date();
    // Local wall-clock timestamp (household tz), NOT UTC — the day-file bucket is
    // its date prefix, so an evening-local read never spills into the next UTC day.
    const ts = formatLocalTimestamp(readAt, timezone);
    const topic = topicForId(id);

    // The relay announces its backlog and any evicted messages on reconnect.
    // A non-zero `dropped` means data was LOST on the device — that must be
    // recorded, not just logged, or an outage leaves no trace in history.
    if (message.type === 'relay-status') {
      const dropped = Number(message.dropped) || 0;
      const log = dropped > 0 ? logger.error : logger.info;
      log?.call(logger, 'omr.relay.status', {
        clientId, id, queued: Number(message.queued) || 0, dropped,
        truncated: Number(message.truncated) || 0,
      });
      eventBus.broadcast(topic, {
        id,
        event: 'relay-status',
        queued: Number(message.queued) || 0,
        dropped,
        truncated: Number(message.truncated) || 0,
        ts,
        source: RELAY_SOURCE,
      });
      return;
    }

    if (message.type === 'sheet') {
      const marks = normalizeMarks(message.marks);
      if (!marks) {
        logger.warn?.('omr.ingest.bad_marks', { clientId, id, marks: message.marks });
        return;
      }
      // Trust our own count over the wire's: `columns` and `markedColumns` are
      // derived values the firmware sends for convenience, and a truncated frame
      // can leave them disagreeing with marks[].
      eventBus.broadcast(topic, {
        id,
        event: 'sheet',
        columns: marks.length,
        markedColumns: marks.filter((m) => m !== 0).length,
        marks,
        ts,
        source: RELAY_SOURCE,
      });
      return;
    }

    // An NFC card tapped on the reader's Grove-port NFC unit — a student
    // announcing "I'm ready", which downstream turns into a session start. The
    // relay was ASSUMED to debounce in hardware (it HLTAs the card, so one
    // physical tap should produce one message). On 2026-08-25 a single tap
    // produced five messages in 103ms, so that assumption is not load-bearing
    // any more — the window below is.
    if (message.type === 'nfc') {
      const uid = typeof message.uid === 'string' ? message.uid.trim().toUpperCase() : '';
      // A UID is the whole payload — without one there is nothing to resolve to a
      // student, so drop it rather than broadcast an unidentifiable tap.
      if (!/^[0-9A-F]{8,20}$/.test(uid)) {
        logger.warn?.('omr.ingest.bad_nfc_uid', { clientId, id, uid: message.uid });
        return;
      }
      const dedupKey = `${id}::${uid}`;
      const prevBroadcastMs = lastBroadcastNfc.get(dedupKey);
      const nfcNowMs = Date.now();
      if (prevBroadcastMs !== undefined && nfcNowMs - prevBroadcastMs < dedupWindowMs) {
        // `info`, not `debug`: debug events are never shipped to the log store,
        // and a suppressed tap must remain visible in production.
        logger.info?.('omr.ingest.nfc_debounced', {
          clientId, id, uid, sinceMs: nfcNowMs - prevBroadcastMs,
        });
        return;
      }
      lastBroadcastNfc.set(dedupKey, nfcNowMs);
      logger.info?.('omr.ingest.nfc', { clientId, id, uid, piccType: message.piccType });
      eventBus.broadcast(topic, {
        id,
        event: 'nfc',
        uid,
        piccType: typeof message.piccType === 'string' ? message.piccType : null,
        atqa: Number.isFinite(Number(message.atqa)) ? Number(message.atqa) : null,
        sak: Number.isFinite(Number(message.sak)) ? Number(message.sak) : null,
        ts,
        source: RELAY_SOURCE,
      });
      return;
    }

    if (message.type === 'reader-error') {
      logger.warn?.('omr.ingest.reader_error', { clientId, id, echo: message.echo });
      eventBus.broadcast(topic, { id, event: 'reader-error', echo: message.echo ?? null, ts, source: RELAY_SOURCE });
      return;
    }

    if (message.type === 'raw') {
      // Bring-up diagnostics only — live on the bus, never on disk.
      logger.debug?.('omr.ingest.raw', { clientId, id, len: message.len });
      eventBus.broadcast(topic, {
        id, event: 'raw', hex: message.hex ?? null, len: Number(message.len) || 0, ts, source: RELAY_SOURCE,
      });
    }
  });

  // ---- 2) PERSIST: bus → disk (sheets + reader errors) --------------------
  // Per-reader dedup state: the signature of the last sheet we RECORDED and when.
  const lastSheet = new Map(); // id -> { signature, atMs }
  // Same idea for NFC taps, keyed on UID so two different cards in quick
  // succession both register — only a REPEAT of the same card is suppressed.
  const lastNfc = new Map();   // id -> { uid, atMs }

  // Serialize all appends through one promise chain: the day-log append is a
  // read-modify-write, so two cards fed in quick succession would otherwise
  // clobber each other's list.
  let writeChain = Promise.resolve();
  const enqueueAppend = (id, record) => {
    writeChain = writeChain
      .then(() => dayLog.append(id, record))
      .catch((err) => logger.warn?.('omr.persist.failed', { id, error: err.message }));
  };

  const onPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const id = payload.id || 'unknown';

    if (payload.event === 'reader-error') {
      enqueueAppend(id, { ts: payload.ts, event: 'reader-error', echo: payload.echo ?? null });
      return;
    }

    // NFC taps are persisted: "who started a session, when" is exactly the sort
    // of thing you want a record of. Deduped per UID on the same window sheets
    // use — a fumbled card can leave and re-enter the field within a moment, and
    // a double tap must not start two sessions or print two tests.
    if (payload.event === 'nfc') {
      const nowMs = Date.now();
      const prev = lastNfc.get(id);
      if (prev && prev.uid === payload.uid && (nowMs - prev.atMs) < dedupWindowMs) {
        logger.debug?.('omr.persist.nfc_deduped', { id, uid: payload.uid, sinceMs: nowMs - prev.atMs });
        return;
      }
      lastNfc.set(id, { uid: payload.uid, atMs: nowMs });
      enqueueAppend(id, {
        ts: payload.ts,
        event: 'nfc',
        uid: payload.uid,
        piccType: payload.piccType ?? null,
      });
      return;
    }

    // Only record a relay-status that reports actual loss. Recording every
    // reconnect would bury the day file in noise — a WiFi blip is not an event,
    // an evicted sheet is.
    if (payload.event === 'relay-status') {
      if (payload.dropped > 0 || payload.truncated > 0) {
        enqueueAppend(id, {
          ts: payload.ts,
          event: 'data-loss',
          dropped: payload.dropped,
          truncated: payload.truncated,
          queued: payload.queued,
        });
      }
      return;
    }

    if (payload.event !== 'sheet') return; // `raw` and anything else: ephemeral

    const marks = normalizeMarks(payload.marks);
    if (!marks) return;

    const signature = marks.join(',');
    const nowMs = Date.now();
    const prev = lastSheet.get(id);
    if (prev && prev.signature === signature && (nowMs - prev.atMs) < dedupWindowMs) {
      logger.debug?.('omr.persist.deduped', { id, sinceMs: nowMs - prev.atMs });
      return;
    }
    lastSheet.set(id, { signature, atMs: nowMs });

    enqueueAppend(id, {
      ts: payload.ts,
      event: 'sheet',
      columns: marks.length,
      markedColumns: marks.filter((m) => m !== 0).length,
      marks,
    });
  };

  const unsubs = [...topics].map((topic) => eventBus.subscribe(topic, onPayload));

  logger.info?.('omr.relay.ready', { topics: [...topics] });
  return { dispose: () => { for (const u of unsubs) { try { u?.(); } catch { /* noop */ } } } };
}

/**
 * Validate and coerce a marks array: one integer 12-bit mask per column.
 * Returns null (rather than throwing) if the frame is unusable — a malformed
 * frame off a serial line is an expected condition, not an exception.
 */
function normalizeMarks(marks) {
  if (!Array.isArray(marks) || marks.length === 0) return null;
  const out = new Array(marks.length);
  for (let i = 0; i < marks.length; i++) {
    const n = Number(marks[i]);
    if (!Number.isInteger(n) || n < 0 || n > MAX_MASK) return null;
    out[i] = n;
  }
  return out;
}


export default createOmrRelay;
