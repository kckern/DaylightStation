// DaylightLogger - Frontend core
// Minimal structured logger with pluggable transports

const LEVELS = ['debug', 'info', 'warn', 'error'];
const LEVEL_PRIORITY = LEVELS.reduce((acc, level, idx) => ({ ...acc, [level]: idx }), {});

const defaultFormatter = (event) => event;

const formatArg = (arg) => {
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg); }
  catch (_) { return String(arg); }
};

const devOutput = (level, ...args) => {
  const message = args.map(formatArg).join(' ');
  const stream = (level === 'error' || level === 'warn') && typeof process !== 'undefined' && process.stderr
    ? process.stderr
    : (typeof process !== 'undefined' && process.stdout ? process.stdout : null);
  if (stream && typeof stream.write === 'function') {
    stream.write(`${message}\n`);
    return;
  }
  if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
    window.postMessage({ type: 'daylight-log', level, message }, '*');
  }
};

const isLevelEnabled = (currentLevel, targetLevel) => {
  const cur = LEVEL_PRIORITY[currentLevel] ?? LEVEL_PRIORITY.info;
  const tgt = LEVEL_PRIORITY[targetLevel] ?? LEVEL_PRIORITY.info;
  return tgt >= cur;
};

const validateEvent = (evt) => {
  if (!evt || typeof evt.event !== 'string' || !evt.event.length) {
    throw new Error('LogEvent must include an event name');
  }
  return evt;
};

// Shared rate-limit state for sampled() across all loggers (mirrors Logger.js)
const SAMPLING_WINDOW_MS = 60000;
const samplingState = new Map();

const accumulateSampledData = (aggregated, data) => {
  for (const [key, value] of Object.entries(data || {})) {
    if (typeof value === 'number') {
      aggregated[key] = (aggregated[key] || 0) + value;
    } else if (typeof value === 'string') {
      if (!aggregated[key]) aggregated[key] = {};
      const counts = aggregated[key];
      if (Object.keys(counts).length < 20) {
        counts[value] = (counts[value] || 0) + 1;
      } else {
        counts['__other__'] = (counts['__other__'] || 0) + 1;
      }
    }
  }
};

/**
 * A bounded queue that says what it threw away.
 *
 * Both WS transports keep a ring and, when it is full, discard the OLDEST
 * queued event. During a storm that is the beginning of the incident — the
 * part you most want — and it went with no counter and no marker, so a log
 * with a hole in it read exactly like a log with nothing missing.
 *
 * So: count the drops, and hand a synthetic `logging.transport.overflow` event
 * to the socket alongside the survivors, so the gap is visible in the stream
 * rather than only in a counter someone has to think to go and read.
 *
 * The marker is held OUTSIDE the ring and attached at take() time. Keeping it
 * in the ring was the obvious design and it is wrong: the marker is by
 * definition the oldest thing in a full queue, so the next drop evicts the
 * record of the gap and the hole goes back to being invisible. Outside the
 * ring it costs no capacity and cannot be evicted.
 *
 * One marker per flush, its count updated in place while the burst continues —
 * a marker per dropped event would be a second flood on top of the first. The
 * count is cumulative for the transport's life, so two bursts are still
 * distinguishable by the number climbing.
 *
 * @param {number} maxQueue - ring capacity (0 or less disables queueing)
 * @param {string} transportName - carried on the marker, so two transports
 *   overflowing are distinguishable
 * @param {(event: object) => object} wrapMarker - wraps the synthetic event in
 *   whatever envelope this transport's queue holds (the two differ)
 */
function createBoundedRing(maxQueue, transportName, wrapMarker) {
  const items = [];
  let dropped = 0;
  let pendingMarker = null; // mutated in place until a take() carries it away

  return {
    get length() { return items.length; },
    get dropped() { return dropped; },

    push(wrapped) {
      if (maxQueue <= 0) return;
      if (items.length >= maxQueue) {
        items.shift();
        dropped += 1;
        if (pendingMarker) {
          pendingMarker.data.droppedCount = dropped;
        } else {
          pendingMarker = {
            ts: new Date().toISOString(),
            level: 'warn',
            event: 'logging.transport.overflow',
            data: { droppedCount: dropped, maxQueue, transport: transportName },
            // The marker adopts the identity of the stream whose events went
            // missing. Without it the context would be bare, and the backend
            // files an event only when its context carries app + sessionLog —
            // so the one event you most want in the durable per-app log would
            // be discarded by the very gate this tier just taught to count.
            context: { ...(wrapped?.event?.context || {}), logger: 'transport' },
            tags: [],
            source: 'frontend',
          };
        }
      }
      items.push(wrapped);
    },

    /**
     * Remove and return up to `n` entries, oldest first, with any outstanding
     * overflow marker at the FRONT — the events it is warning about went
     * missing before the ones that survived.
     */
    take(n) {
      const batch = items.splice(0, n);
      if (pendingMarker) {
        batch.unshift(wrapMarker(pendingMarker));
        pendingMarker = null;
      }
      return batch;
    },

    stats() { return { queued: items.length, dropped, maxQueue }; },
  };
}

function consoleTransport() {
  return {
    name: 'console',
    send: (evt) => {
      devOutput(evt.level, '[DaylightLogger]', JSON.stringify(evt));
    }
  };
}

function createWebSocketTransport(options = {}) {
  if (typeof window === 'undefined') return null;

  const {
    topic = 'logging',
    maxQueue = 200
  } = options;

  let wsServiceInstance = null;
  const ring = createBoundedRing(maxQueue, 'ws', (evt) => ({ topic, event: evt }));

  // Dynamically import shared WebSocketService to avoid circular deps
  const getWsService = async () => {
    if (wsServiceInstance) return wsServiceInstance;
    try {
      const { wsService } = await import('../../services/WebSocketService.js');
      wsServiceInstance = wsService;
      // Ensure connection is established for logging transport
      if (typeof wsService.connect === 'function') {
        wsService.connect();
      }
      return wsServiceInstance;
    } catch (err) {
      devOutput('error', '[DaylightLogger] Failed to load WebSocketService', err);
      return null;
    }
  };

  const flush = async () => {
    const ws = await getWsService();
    if (!ws) return;

    // take() can hand back more than asked for — an overflow marker rides
    // along at the front — so send whatever it returns, not just its head.
    while (ring.length) {
      for (const payload of ring.take(1)) {
        try {
          ws.send(payload);
        } catch (err) {
          devOutput('warn', '[DaylightLogger] WS send failed', err);
          return;
        }
      }
    }
  };

  return {
    name: 'ws',
    send: (evt) => {
      ring.push({ topic, event: evt });
      flush();
    },
    flush,
    getStats: () => ring.stats()
  };
}

// Buffering transport that batches events before sending over WebSocket
function createBufferingWebSocketTransport(options = {}) {
  if (typeof window === 'undefined') return null;

  const {
    topic = 'logging',
    maxQueue = 500,
    batchSize = 20,
    flushInterval = 1000
  } = options;

  let wsServiceInstance = null;
  let flushTimer = null;
  const ring = createBoundedRing(maxQueue, 'ws-buffered', (evt) => ({ event: evt }));

  // Dynamically import shared WebSocketService to avoid circular deps
  const getWsService = async () => {
    if (wsServiceInstance) return wsServiceInstance;
    try {
      const { wsService } = await import('../../services/WebSocketService.js');
      wsServiceInstance = wsService;
      // Ensure connection is established for logging transport
      if (typeof wsService.connect === 'function') {
        wsService.connect();
      }
      return wsServiceInstance;
    } catch (err) {
      devOutput('error', '[DaylightLogger] Failed to load WebSocketService', err);
      return null;
    }
  };

  const sendBatch = async (batch) => {
    if (!batch.length) return;
    const ws = await getWsService();
    if (!ws) return;
    
    try {
      ws.send({ topic, events: batch });
    } catch (err) {
      devOutput('warn', '[DaylightLogger] WS batch send failed', err);
    }
  };

  const flush = async () => {
    if (!ring.length) return;
    const batch = ring.take(batchSize);
    await sendBatch(batch);
    if (ring.length) {
      // keep flushing until drained
      await flush();
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, flushInterval);
  };

  return {
    name: 'ws-buffered',
    send: (evt) => {
      ring.push({ event: evt });
      if (ring.length >= batchSize) {
        flush();
      } else {
        scheduleFlush();
      }
    },
    flush,
    getStats: () => ring.stats()
  };
}

function createLogger({ name = 'frontend', context = {}, level = 'info', transports = [consoleTransport()], formatter = defaultFormatter, sampling = null } = {}) {
  const baseContext = { logger: name, ...context };

  const shouldSample = (sample) => {
    if (!sample) return false;
    const rate = typeof sample === 'number' ? sample : sample.rate;
    if (!Number.isFinite(rate)) return false;
    return Math.random() > Math.max(0, Math.min(1, rate));
  };

  const emit = (levelName, eventName, data = {}, options = {}) => {
    if (!isLevelEnabled(level, levelName)) return;
    const sampledOut = shouldSample(options.sampleRate || sampling);
    if (sampledOut) return;
    const evt = {
      ts: new Date().toISOString(),
      level: levelName,
      event: eventName,
      message: options.message,
      data: data || {},
      context: { ...baseContext, ...(options.context || {}) },
      tags: options.tags || [],
      source: options.source || 'frontend'
    };
    validateEvent(evt);
    const formatted = formatter(evt);
    transports.filter(Boolean).forEach((t) => {
      try {
        t.send(formatted);
      } catch (err) {
        devOutput('warn', '[DaylightLogger] transport failure', t.name, err);
      }
    });
  };

  // Rate-limited emit with optional aggregation of skipped events (mirrors Logger.js)
  const sampled = (eventName, data = {}, options = {}) => {
    const { maxPerMinute = 20, aggregate = true } = options;
    const now = Date.now();
    let state = samplingState.get(eventName);

    // New window or first call: flush previous window's aggregate
    if (!state || now - state.windowStart >= SAMPLING_WINDOW_MS) {
      if (state?.skipped > 0 && aggregate) {
        emit('info', `${eventName}.aggregated`, {
          sampledCount: state.count,
          skippedCount: state.skipped,
          window: '60s',
          aggregated: state.aggregated
        });
      }
      state = { count: 0, skipped: 0, aggregated: {}, windowStart: now };
      samplingState.set(eventName, state);
    }

    // Within budget: log normally
    if (state.count < maxPerMinute) {
      state.count += 1;
      emit('info', eventName, data);
      return;
    }

    // Over budget: accumulate for summary
    state.skipped += 1;
    if (aggregate) accumulateSampledData(state.aggregated, data);
  };

  const child = (childContext = {}) => createLogger({ name, context: { ...baseContext, ...childContext }, level, transports, formatter, sampling });

  return {
    log: emit,
    debug: (eventName, data, opts) => emit('debug', eventName, data, opts),
    info: (eventName, data, opts) => emit('info', eventName, data, opts),
    warn: (eventName, data, opts) => emit('warn', eventName, data, opts),
    error: (eventName, data, opts) => emit('error', eventName, data, opts),
    sampled,
    child
  };
}

export { createLogger, consoleTransport, createWebSocketTransport, createBufferingWebSocketTransport };
export default createLogger;
