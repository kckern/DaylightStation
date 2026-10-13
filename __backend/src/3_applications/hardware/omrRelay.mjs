// OMR application policy: debounce accepted semantic reads and persist the
// meaningful audit stream. Firmware frames and event-bus topics live in the
// injected relay gateway.

const DEFAULT_DEDUP_WINDOW_MS = 2000;
const MAX_MASK = (1 << 12) - 1;

export function createOmrRelay({ relayGateway, dayLog, dedupWindowMs = DEFAULT_DEDUP_WINDOW_MS, logger = console }) {
  if (!relayGateway?.subscribe) throw new Error('createOmrRelay: relayGateway required');

  dedupWindowMs = Number(dedupWindowMs);
  const lastBroadcastNfc = new Map();
  const lastSheet = new Map();
  const lastNfc = new Map();
  let writeChain = Promise.resolve();

  const enqueueAppend = (id, record) => {
    writeChain = writeChain.then(() => dayLog.append(id, record))
      .catch((error) => logger.warn?.('omr.persist.failed', { id, error: error.message }));
  };

  const persist = (payload) => {
    const id = payload.id || 'unknown';
    if (payload.event === 'reader-error') {
      enqueueAppend(id, { ts: payload.ts, event: 'reader-error', echo: payload.echo ?? null });
      return;
    }
    if (payload.event === 'nfc') {
      const at = Date.now();
      const previous = lastNfc.get(id);
      if (previous && previous.uid === payload.uid && at - previous.atMs < dedupWindowMs) return;
      lastNfc.set(id, { uid: payload.uid, atMs: at });
      enqueueAppend(id, { ts: payload.ts, event: 'nfc', uid: payload.uid, piccType: payload.piccType ?? null });
      return;
    }
    if (payload.event === 'relay-status') {
      if (payload.dropped > 0 || payload.truncated > 0) enqueueAppend(id, {
        ts: payload.ts, event: 'data-loss', dropped: payload.dropped,
        truncated: payload.truncated, queued: payload.queued,
      });
      return;
    }
    if (payload.event !== 'sheet') return;
    const marks = normalizeMarks(payload.marks); if (!marks) return;
    const signature = marks.join(','); const at = Date.now(); const previous = lastSheet.get(id);
    if (previous && previous.signature === signature && at - previous.atMs < dedupWindowMs) return;
    lastSheet.set(id, { signature, atMs: at });
    enqueueAppend(id, { ts: payload.ts, event: 'sheet', columns: marks.length,
      markedColumns: marks.filter((mark) => mark !== 0).length, marks });
  };

  const unsubscribe = relayGateway.subscribe((payload, metadata = {}) => {
    if (payload.event === 'nfc') {
      const key = `${payload.id}::${payload.uid}`;
      const at = Date.now(); const previous = lastBroadcastNfc.get(key);
      if (previous !== undefined && at - previous < dedupWindowMs) {
        logger.info?.('omr.ingest.nfc_debounced', {
          clientId: metadata.clientId, id: payload.id, uid: payload.uid, sinceMs: at - previous,
        });
        return false;
      }
      lastBroadcastNfc.set(key, at);
    }
    persist(payload);
    return true;
  });

  logger.info?.('omr.relay.ready');
  return { dispose: () => { try { unsubscribe?.(); } catch {} }, flush: () => writeChain };
}

function normalizeMarks(marks) {
  if (!Array.isArray(marks) || marks.length === 0) return null;
  const out = marks.map(Number);
  return out.every((mark) => Number.isInteger(mark) && mark >= 0 && mark <= MAX_MASK) ? out : null;
}

export default createOmrRelay;
