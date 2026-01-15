/**
 * Logger - Frontend logging module
 * 
 * Single entry point for all frontend logging. Uses shared WebSocket transport
 * from sharedTransport.js to prevent duplicate connections.
 */

import { getSharedWsTransport } from './sharedTransport.js';

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
 */
const emitSampled = (eventName, data = {}, options = {}) => {
  const { maxPerMinute = 20, aggregate = true } = options;
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
      });
    }
    state = { count: 0, skipped: 0, aggregated: {}, windowStart: now };
    samplingState.set(eventName, state);
  }

  // Within budget: log normally
  if (state.count < maxPerMinute) {
    state.count++;
    emit('info', eventName, data);
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
const child = (childContext = {}) => {
  const parentContext = { ...config.context };
  return {
    log: (level, eventName, data, opts) => emit(level, eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    debug: (eventName, data, opts) => emit('debug', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    info: (eventName, data, opts) => emit('info', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    warn: (eventName, data, opts) => emit('warn', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    error: (eventName, data, opts) => emit('error', eventName, data, { ...opts, context: { ...parentContext, ...childContext, ...(opts?.context || {}) } }),
    child: (ctx) => child({ ...parentContext, ...childContext, ...ctx })
  };
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
      configure
    };
  }
  return singleton;
};

/**
 * Get current configuration (for debugging)
 */
export const getConfig = () => ({ ...config });

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

// Compatibility exports
export default getLogger;
