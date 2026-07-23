/**
 * Logger - Frontend logging module
 * 
 * Single entry point for all frontend logging. Uses shared WebSocket transport
 * from sharedTransport.js to prevent duplicate connections.
 */

import { getSharedWsTransport } from './sharedTransport.js';
import { readHeap } from '../perf/memoryProbe.js';
import {
  startJankProbes,
  stopJankProbes,
  readJankProbes,
  readRenderRegistry,
} from './jankProbes.js';

const LEVELS = ['debug', 'info', 'warn', 'error'];
const LEVEL_PRIORITY = LEVELS.reduce((acc, level, idx) => ({ ...acc, [level]: idx }), {});

const DEFAULT_OPTIONS = Object.freeze({
  name: 'frontend',
  level: 'info',
  context: {},
  topic: 'logging',
  consoleEnabled: true,
  websocketEnabled: true
});

// Module-level state
let singleton = null;
let config = { ...DEFAULT_OPTIONS };
let wsTransport = null;

// Sampling state for rate-limited logging (module-level, shared across instances)
let samplingState = new Map();
const WINDOW_MS = 60_000;

/**
 * Reset sampling state (for testing)
 */
export const resetSamplingState = () => {
  samplingState = new Map();
};

const formatArg = (arg) => {
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg); }
  catch (_) { return String(arg); }
};

const devOutput = (level, ...args) => {
  if (!config.consoleEnabled) return;
  const message = args.map(formatArg).join(' ');
  
  // Use postMessage in browser for test environments that capture it
  if (typeof window !== 'undefined' && typeof window.postMessage === 'function') {
    window.postMessage({ type: 'frontend-log', level, message }, '*');
  }
  
  // Console output
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  if (typeof console !== 'undefined' && console[method]) {
    console[method](`[Logger] ${message}`);
  }
};

const isLevelEnabled = (targetLevel) => {
  const cur = LEVEL_PRIORITY[config.level] ?? LEVEL_PRIORITY.info;
  const tgt = LEVEL_PRIORITY[targetLevel] ?? LEVEL_PRIORITY.info;
  return tgt >= cur;
};

const ensureTransport = () => {
  if (!config.websocketEnabled) return null;
  if (!wsTransport) {
    wsTransport = getSharedWsTransport({
      topic: config.topic,
      url: config.websocketUrl
    });
  }
  return wsTransport;
};

// Recent-events ring buffer — an in-memory tail of the last RECENT_MAX emitted
// events, so a feature (e.g. voice feedback) can snapshot what just happened
// before those logs rotate out of the backend session file. Kept slim (no deep
// data clones) to stay cheap.
const RECENT_MAX = 300;
const recentEvents = [];

/**
 * Snapshot the most recent emitted log events (newest last).
 * @param {number} [n=150] - how many trailing events to return
 * @returns {Array<{ts,level,event,data,context}>}
 */
export const getRecentEvents = (n = 150) => recentEvents.slice(-Math.max(0, n));

/**
 * Emit a log event
 */
const emit = (level, eventName, data = {}, options = {}) => {
  if (!isLevelEnabled(level)) return;

  const event = {
    ts: new Date().toISOString(),
    level,
    event: eventName,
    message: options.message,
    data: data || {},
    source: options.source || config.name,
    context: { ...config.context, ...(options.context || {}) },
    tags: options.tags || []
  };

  // Tail into the ring buffer (slim copy; bounded).
  recentEvents.push({ ts: event.ts, level, event: eventName, data: event.data, context: event.context });
  if (recentEvents.length > RECENT_MAX) recentEvents.splice(0, recentEvents.length - RECENT_MAX);

  // Console output (immediate)
  if (config.consoleEnabled) {
    const dataStr = Object.keys(event.data).length ? JSON.stringify(event.data) : '';
    devOutput(level, `${event.event}${dataStr ? ' ' + dataStr : ''}`);
  }

  // WebSocket transport (uses shared transport)
  if (config.websocketEnabled) {
    const transport = ensureTransport();
    if (transport) {
      transport.send(event);
    }
  }
};

/**
 * Accumulate data for aggregation
 */
const accumulateData = (aggregated, data) => {
  for (const [key, value] of Object.entries(data)) {
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
 * Emit a sampled log event with rate limiting
 * @param {string} eventName
 * @param {object} data
 * @param {object} options - { maxPerMinute, aggregate }
 * @param {object} [emitContext] - merged context to forward to emit() (used by child loggers)
 */
const emitSampled = (eventName, data = {}, options = {}, emitContext) => {
  const { maxPerMinute = 20, aggregate = true } = options;
  const emitOpts = emitContext ? { context: emitContext } : {};
  const now = Date.now();

  let state = samplingState.get(eventName);

  // New window or first call
  if (!state || now - state.windowStart >= WINDOW_MS) {
    // Flush previous window's aggregate
    if (state?.skipped > 0 && aggregate) {
      emit('info', `${eventName}.aggregated`, {
        sampledCount: state.count,
        skippedCount: state.skipped,
        window: '60s',
        aggregated: state.aggregated
      }, emitOpts);
    }
    state = { count: 0, skipped: 0, aggregated: {}, windowStart: now };
    samplingState.set(eventName, state);
  }

  // Within budget: log normally
  if (state.count < maxPerMinute) {
    state.count++;
    emit('info', eventName, data, emitOpts);
    return;
  }

  // Over budget: accumulate for summary
  state.skipped++;
  if (aggregate) {
    accumulateData(state.aggregated, data);
  }
};

/**
 * Create a child logger with additional context
 */
const child = (childContext = {}, parentHasSessionLog = false) => {
  const parentContext = { ...config.context };
  const childLogger = {
    log: (level, eventName, data, opts) => emit(level, eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    debug: (eventName, data, opts) => emit('debug', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    info: (eventName, data, opts) => emit('info', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    warn: (eventName, data, opts) => emit('warn', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    error: (eventName, data, opts) => emit('error', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    sampled: (eventName, data, opts) => emitSampled(eventName, data, opts, { ...parentContext, ...childContext }),
    // Thread whether sessionLog is ALREADY on down the chain: a child derived from
    // a sessionLog logger inherits sessionLog in its merged childContext, but it did
    // not freshly turn it on — so it must not re-emit session-log.start.
    child: (ctx) => child({ ...parentContext, ...childContext, ...ctx }, parentHasSessionLog || !!childContext.sessionLog)
  };

  // Auto-emit session start ONLY when THIS child freshly turns sessionLog on — not
  // when it merely inherited it from a sessionLog parent (which would double-open
  // the backend session file, fragmenting the run log).
  if (childContext.sessionLog && !parentHasSessionLog) {
    childLogger.info('session-log.start', { app: childContext.app || parentContext.app });
  }

  return childLogger;
};

/**
 * Configure the logger
 */
export const configure = (options = {}) => {
  config = {
    ...config,
    ...options,
    context: { ...config.context, ...(options.context || {}) }
  };
  
  // Reset transport if URL or topic changed
  if (options.websocketUrl !== undefined || options.topic !== undefined) {
    wsTransport = null;
  }
  
  return getLogger();
};

/**
 * Get the singleton logger instance
 */
export const getLogger = () => {
  if (!singleton) {
    singleton = {
      log: emit,
      debug: (eventName, data, opts) => emit('debug', eventName, data, opts),
      info: (eventName, data, opts) => emit('info', eventName, data, opts),
      warn: (eventName, data, opts) => emit('warn', eventName, data, opts),
      error: (eventName, data, opts) => emit('error', eventName, data, opts),
      sampled: emitSampled,
      child,
      configure,
      startDiagnostics,
      stopDiagnostics,
      perfSnapshot,
    };
  }
  return singleton;
};

/**
 * Get current configuration (for debugging)
 */
export const getConfig = () => ({ ...config });

// ─── Performance Diagnostics ───────────────────────────────────

const DIAG_MAX_SAMPLES = 300; // ~5s at 60fps

const diagState = {
  running: false,
  rafId: null,
  intervalId: null,
  // Circular buffer for frame times
  frameTimes: new Float64Array(DIAG_MAX_SAMPLES),
  head: 0,       // next write position
  count: 0,      // number of valid samples (max 300)
  lastFrameTs: 0,
};

function diagFrame(ts) {
  if (!diagState.running) return;
  if (diagState.lastFrameTs > 0) {
    const dt = ts - diagState.lastFrameTs;
    diagState.frameTimes[diagState.head] = dt;
    diagState.head = (diagState.head + 1) % DIAG_MAX_SAMPLES;
    if (diagState.count < DIAG_MAX_SAMPLES) diagState.count++;
  }
  diagState.lastFrameTs = ts;
  diagState.rafId = requestAnimationFrame(diagFrame);
}

function collectSnapshot() {
  const buf = diagState.frameTimes;
  const count = diagState.count;

  let fps = 0, avgMs = 0, minMs = 0, maxMs = 0, jank = 0;
  if (count > 0) {
    let sum = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < count; i++) {
      const v = buf[i];
      sum += v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      if (v > 33.4) jank++;
    }
    avgMs = sum / count;
    fps = 1000 / avgMs;
    minMs = lo;
    maxMs = hi;
  }

  // Heap where the browser provides it. `source` is always present so a null
  // usedMB reads as "this browser won't say", not as "nothing allocated".
  const { heapMB, heapTotalMB, heapLimitMB, heapSource } = readHeap({ precision: 1 });
  const heap = {
    usedMB: heapMB,
    totalMB: heapTotalMB,
    limitMB: heapLimitMB,
    source: heapSource,
  };

  const domNodes = typeof document !== 'undefined'
    ? document.getElementsByTagName('*').length
    : 0;

  // Why-is-it-slow probes. loopLag vs fps is the key read: low fps + low loopLag
  // + no longTasks ⇒ compositor/GPU stall (JS idle); low fps + high loopLag ⇒
  // main-thread saturation. slowEvents surfaces "unresponsive" static UI, and
  // renders attributes a re-render storm to a specific component.
  const { loopLag, longTasks, slowEvents } = readJankProbes();
  const renders = readRenderRegistry();

  return {
    fps: +fps.toFixed(1),
    frameMs: { avg: +avgMs.toFixed(1), min: +minMs.toFixed(1), max: +maxMs.toFixed(1) },
    jankFrames: jank,
    sampleCount: count,
    heap,
    domNodes,
    loopLag,
    longTasks,
    slowEvents,
    ...(renders ? { renders } : {}),
    // rAF throttles to ~1fps when the page/backlight is off — without this
    // field a dark screen is indistinguishable from real jank in the logs.
    visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
  };
}

/**
 * Start periodic performance diagnostics.
 * Emits 'perf.diagnostics' via the logger at the given interval.
 *
 * Re-entrant: calling while already running with a DIFFERENT interval re-arms
 * the reporting cadence in place (the rAF sampler keeps running) — so a
 * fine-grained consumer (the side-scroller at 5s) can temporarily override an
 * always-on coarse cadence (app-wide 60s) and hand it back on cleanup.
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=5000] - How often to emit a snapshot
 */
export const startDiagnostics = (opts = {}) => {
  const intervalMs = opts.intervalMs ?? 5000;
  if (diagState.running) {
    if (diagState.intervalMs === intervalMs) return;
    clearInterval(diagState.intervalId);
    diagState.intervalMs = intervalMs;
    diagState.intervalId = setInterval(() => {
      const snap = collectSnapshot();
      emit('info', 'perf.diagnostics', snap);
      if (typeof window !== 'undefined') window.__PERF_DIAG__ = snap;
    }, intervalMs);
    emit('info', 'perf.diagnostics.rearmed', { intervalMs });
    return;
  }

  diagState.running = true;
  diagState.intervalMs = intervalMs;
  diagState.frameTimes = new Float64Array(DIAG_MAX_SAMPLES);
  diagState.head = 0;
  diagState.count = 0;
  diagState.lastFrameTs = 0;
  diagState.rafId = requestAnimationFrame(diagFrame);
  startJankProbes(); // loop-lag / long-task / slow-event probes live with diagnostics

  diagState.intervalId = setInterval(() => {
    const snap = collectSnapshot();
    emit('info', 'perf.diagnostics', snap);
    // Also expose on window for live debugging
    if (typeof window !== 'undefined') {
      window.__PERF_DIAG__ = snap;
    }
  }, intervalMs);

  emit('info', 'perf.diagnostics.started', { intervalMs });
};

/**
 * Stop performance diagnostics.
 */
export const stopDiagnostics = () => {
  diagState.running = false;
  if (diagState.rafId != null) {
    cancelAnimationFrame(diagState.rafId);
    diagState.rafId = null;
  }
  if (diagState.intervalId != null) {
    clearInterval(diagState.intervalId);
    diagState.intervalId = null;
  }
  diagState.frameTimes = new Float64Array(DIAG_MAX_SAMPLES);
  diagState.head = 0;
  diagState.count = 0;
  diagState.lastFrameTs = 0;
  stopJankProbes();
  if (typeof window !== 'undefined') {
    delete window.__PERF_DIAG__;
  }
  emit('info', 'perf.diagnostics.stopped', {});
};

/**
 * Take a one-shot performance snapshot without starting the periodic reporter.
 * (Requires diagnostics to already be running for FPS data.)
 */
export const perfSnapshot = () => collectSnapshot();

/**
 * Get WebSocket state (for debugging/health checks)
 * Note: Now delegates to shared transport
 */
export const getStatus = () => {
  const transport = wsTransport;
  if (!transport) {
    return {
      connected: false,
      queueLength: 0,
      reconnecting: false
    };
  }
  // Transport doesn't expose internal state, so return basic info
  return {
    connected: true, // If transport exists, assume it's managing connection
    queueLength: 0, // Queue is internal to transport
    reconnecting: false
  };
};

// Expose diagnostics on window for browser console access:
//   window.__PERF__.start()   — start periodic reporting
//   window.__PERF__.stop()    — stop
//   window.__PERF__.snap()    — one-shot snapshot
//   window.__PERF_DIAG__      — latest snapshot (auto-updated while running)
if (typeof window !== 'undefined') {
  window.__PERF__ = {
    start: startDiagnostics,
    stop: stopDiagnostics,
    snap: perfSnapshot,
  };
}

// Compatibility exports
export default getLogger;
