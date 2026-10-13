/**
 * HTTP log sink transport.
 *
 * Ships events to a log-ingestion service as newline-delimited JSON.
 *
 * DELIBERATELY VENDOR-NEUTRAL. This file knows how to batch events and POST
 * them; it does not know which product is listening. Everything product-shaped
 * — the host, the ingest path, and any field-mapping query parameters — lives
 * in the configured `url`. Swapping the backing service is then a config edit
 * with no code change, which is the same reason `logging.fileSink.path` exists.
 *
 * WHY NOT REUSE THE LOGGLY TRANSPORT: that one drags in `winston` plus
 * `winston-loggly-bulk` to do buffering this file does in ~40 lines against the
 * platform's own `fetch`. A log shipper earning two dependencies was a bad
 * trade even before the vendor stopped being usable.
 *
 * ┌─ THE RULE THIS FILE OBEYS ────────────────────────────────────────────────┐
 * │ A logging failure must cost the log, never the server. The sink is a       │
 * │ network call to a container that can be down, full, or mid-restart, and    │
 * │ none of that may surface to a caller who only wanted to record an event.   │
 * │ So: `send` never throws, never awaits, and never grows without bound.      │
 * │ When the far end is gone the events are dropped and counted — reporting a  │
 * │ known loss beats an unbounded buffer that eventually takes the process     │
 * │ with it, which is the failure mode that matters on a household server      │
 * │ nobody is watching.                                                        │
 * │                                                                            │
 * │ It must also never log through the framework it is part of: an error path  │
 * │ that emits an event would feed itself. Diagnostics go to stderr, the one   │
 * │ channel that cannot be the thing that broke.                               │
 * └────────────────────────────────────────────────────────────────────────────┘
 */

/** Batch once this many events are queued, without waiting for the timer. */
const DEFAULT_BATCH_SIZE = 50;

/** Ship a partial batch this often, so a quiet system still reports promptly. */
const DEFAULT_FLUSH_INTERVAL_MS = 5000;

/**
 * Hard ceiling on queued events. At the measured intake (~63 MB/day, well under
 * 100 events/sec) this is minutes of outage before anything is lost, and a few
 * MB of memory at worst — small enough to be safe, large enough to ride out a
 * container restart of the sink.
 */
const DEFAULT_MAX_BUFFER_EVENTS = 10_000;

/** A slow sink must not hold a socket open indefinitely. */
const DEFAULT_TIMEOUT_MS = 10_000;

function positiveNumber(value, fallback) {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Create an HTTP log sink transport.
 *
 * @param {object} options
 * @param {string} options.url - Absolute ingest URL, including any field-mapping
 *   query parameters the receiving service expects. Required; without it the
 *   transport is a no-op, matching how the Loggly slot behaves unconfigured.
 * @param {object} [options.headers] - Extra request headers (e.g. auth).
 * @param {number} [options.batchSize]
 * @param {number} [options.flushIntervalMs]
 * @param {number} [options.maxBufferEvents]
 * @param {number} [options.timeoutMs]
 * @param {typeof fetch} [options.fetchImpl] - Injectable for tests.
 * @returns {{name: string, send: Function, flush: Function, getStatus: Function, close: Function}}
 */
export function createHttpLogSinkTransport(options = {}) {
  const {
    url,
    headers = {},
    fetchImpl = globalThis.fetch,
  } = options;

  const batchSize = positiveNumber(options.batchSize, DEFAULT_BATCH_SIZE);
  const flushIntervalMs = positiveNumber(options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS);
  const maxBufferEvents = positiveNumber(options.maxBufferEvents, DEFAULT_MAX_BUFFER_EVENTS);
  const timeoutMs = positiveNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS);

  // Unconfigured is a normal state, not an error: dev machines opt out. Return a
  // no-op rather than throwing so the dispatcher's other transports are unaffected.
  if (!url || typeof url !== 'string' || !url.trim()) {
    return {
      name: 'http-log-sink-disabled',
      send() {},
      flush() { return Promise.resolve(); },
      close() {},
      getStatus() {
        return { name: 'http-log-sink', status: 'disabled', reason: 'no url configured' };
      },
    };
  }

  if (typeof fetchImpl !== 'function') {
    process.stderr.write('[HttpLogSink] No fetch implementation available, transport disabled\n');
    return {
      name: 'http-log-sink-disabled',
      send() {},
      flush() { return Promise.resolve(); },
      close() {},
      getStatus() {
        return { name: 'http-log-sink', status: 'disabled', reason: 'no fetch available' };
      },
    };
  }

  let buffer = [];
  let inFlight = null;
  let eventsSent = 0;
  let eventsDropped = 0;
  let batchesFailed = 0;
  let lastError = null;
  let lastFlush = null;
  let closed = false;

  /**
   * One POST of NDJSON. Resolves either way — the caller must never see a
   * rejection, or an unhandled rejection takes down a process that was only
   * trying to write a log line.
   */
  async function post(batch) {
    const body = batch.map((e) => JSON.stringify(e)).join('\n');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/stream+json', ...headers },
        body,
        signal: controller.signal,
      });
      if (!res?.ok) {
        // The batch is deliberately NOT re-queued. Retrying into a sink that is
        // rejecting turns a broken dependency into an ever-growing backlog, and
        // the events are diagnostics that are also on stdout and in the file sink.
        batchesFailed++;
        lastError = `HTTP ${res?.status ?? 'unknown'}`;
        eventsDropped += batch.length;
        process.stderr.write(`[HttpLogSink] ingest rejected (${lastError}), dropped ${batch.length} events\n`);
        return;
      }
      eventsSent += batch.length;
      lastFlush = new Date().toISOString();
    } catch (err) {
      batchesFailed++;
      lastError = err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : (err?.message || String(err));
      eventsDropped += batch.length;
      process.stderr.write(`[HttpLogSink] ingest failed (${lastError}), dropped ${batch.length} events\n`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Drain the buffer. Batches are serialized: one POST at a time keeps event
   * order intact and stops a slow sink from accumulating concurrent requests.
   */
  function drain() {
    if (inFlight || buffer.length === 0) return inFlight ?? Promise.resolve();
    const batch = buffer;
    buffer = [];
    inFlight = post(batch).finally(() => {
      inFlight = null;
      // More arrived while that batch was in the air.
      if (buffer.length > 0 && !closed) drain();
    });
    return inFlight;
  }

  // `unref` so a pending timer never holds the process open at shutdown.
  const timer = setInterval(() => { if (!closed) drain(); }, flushIntervalMs);
  timer.unref?.();

  return {
    name: 'http-log-sink',

    send(event) {
      if (closed) return;
      try {
        if (buffer.length >= maxBufferEvents) {
          // Drop the OLDEST. During an outage the newest events describe what is
          // happening now, which is what someone reading this later needs.
          buffer.shift();
          eventsDropped++;
        }
        buffer.push(event);
        if (buffer.length >= batchSize) drain();
      } catch {
        // Unreachable in practice, but `send` is on the hot path of every log
        // call in the process and must not be the thing that throws.
        eventsDropped++;
      }
    },

    flush() {
      try {
        return Promise.resolve(drain()).catch(() => {});
      } catch {
        return Promise.resolve();
      }
    },

    close() {
      closed = true;
      clearInterval(timer);
    },

    getStatus() {
      return {
        name: 'http-log-sink',
        status: batchesFailed > 0 && eventsSent === 0 ? 'error' : 'ok',
        eventsSent,
        eventsDropped,
        batchesFailed,
        buffered: buffer.length,
        lastError,
        lastFlush,
        config: { url, batchSize, flushIntervalMs, maxBufferEvents, timeoutMs },
      };
    },
  };
}

export default createHttpLogSinkTransport;
