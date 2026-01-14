/**
 * Logger - Frontend logging module
 * 
 * Single entry point for all frontend logging. Batches events and sends
 * via WebSocket to backend, which normalizes and forwards to Loggly.
 */

const LEVELS = ['debug', 'info', 'warn', 'error'];
const LEVEL_PRIORITY = LEVELS.reduce((acc, level, idx) => ({ ...acc, [level]: idx }), {});

const DEFAULT_OPTIONS = Object.freeze({
  name: 'frontend',
  level: 'info',
  context: {},
  topic: 'logging',
  maxQueue: 500,
  batchSize: 20,
  flushInterval: 1000,
  reconnectBaseDelay: 800,
  reconnectMaxDelay: 6000,
  consoleEnabled: true,
  websocketEnabled: true
});

// Module-level state
let singleton = null;
let config = { ...DEFAULT_OPTIONS };

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

// Adaptive throttling for logger WebSocket: 1s, 2s, 5s, 15s, 1min, 5min, 15min (terminal)
const LOGGER_RECONNECT_DELAYS = [1000, 2000, 5000, 15000, 60000, 300000, 900000];

// WebSocket transport state
const wsState = {
  socket: null,
  connecting: false,
  queue: [],
  reconnectTier: 0,
  reconnectTimer: null,
  flushTimer: null
};

const resolveWebSocketUrl = () => {
  if (config.websocketUrl) return config.websocketUrl;
  if (typeof window === 'undefined' || !window.location?.origin) return null;
  return window.location.origin.replace(/^http/, 'ws') + '/ws';
};

const sendBatch = (batch) => {
  if (!wsState.socket || wsState.socket.readyState !== WebSocket.OPEN || !batch.length) return;
  try {
    // Send batch to backend ingestion service
    wsState.socket.send(JSON.stringify({ 
      topic: config.topic, 
      events: batch 
    }));
  } catch (err) {
    devOutput('warn', 'WebSocket batch send failed', err);
  }
};

const flush = () => {
  if (!wsState.socket || wsState.socket.readyState !== WebSocket.OPEN) return;
  if (!wsState.queue.length) return;
  
  const batch = wsState.queue.splice(0, config.batchSize);
  sendBatch(batch);
  
  // Keep flushing if more in queue
  if (wsState.queue.length) {
    flush();
  }
};

const scheduleFlush = () => {
  if (wsState.flushTimer) return;
  wsState.flushTimer = setTimeout(() => {
    wsState.flushTimer = null;
    flush();
  }, config.flushInterval);
};

const scheduleReconnect = () => {
  if (wsState.reconnectTimer) return;
  
  const delay = LOGGER_RECONNECT_DELAYS[
    Math.min(wsState.reconnectTier, LOGGER_RECONNECT_DELAYS.length - 1)
  ];
  
  const tierLabel = wsState.reconnectTier < LOGGER_RECONNECT_DELAYS.length ? `tier ${wsState.reconnectTier}` : 'terminal';
  const delayLabel = delay >= 60000 ? `${delay / 60000}min` : `${delay / 1000}s`;
  devOutput('debug', `Logger reconnecting in ${delayLabel} (${tierLabel})`);
  
  wsState.reconnectTimer = setTimeout(() => {
    wsState.reconnectTimer = null;
    wsState.reconnectTier++;
    ensureWebSocket();
  }, delay);
};

const ensureWebSocket = () => {
  if (!config.websocketEnabled) return;
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
  if (wsState.connecting) return;
  if (wsState.socket?.readyState === WebSocket.OPEN) {
    flush();
    return;
  }
  if (wsState.socket?.readyState === WebSocket.CONNECTING) return;

  const url = resolveWebSocketUrl();
  if (!url) return;

  wsState.connecting = true;
  try {
    wsState.socket = new WebSocket(url);
    
    wsState.socket.onopen = () => {
      wsState.connecting = false;
      wsState.reconnectTier = 0; // Reset tier on successful connection
      devOutput('debug', 'WebSocket connected');
      flush();
    };
    
    wsState.socket.onclose = () => {
      wsState.connecting = false;
      wsState.socket = null;
      scheduleReconnect();
    };
    
    wsState.socket.onerror = () => {
      wsState.connecting = false;
      wsState.socket = null;
      scheduleReconnect();
    };
  } catch (err) {
    wsState.connecting = false;
    wsState.socket = null;
    devOutput('warn', 'Failed to open WebSocket', err);
    scheduleReconnect();
  }
};

const enqueue = (event) => {
  if (config.maxQueue > 0) {
    if (wsState.queue.length >= config.maxQueue) {
      wsState.queue.shift(); // Drop oldest
    }
    wsState.queue.push(event);
  }
  
  ensureWebSocket();
  
  if (wsState.queue.length >= config.batchSize) {
    flush();
  } else {
    scheduleFlush();
  }
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

  // WebSocket transport (batched)
  if (config.websocketEnabled) {
    enqueue(event);
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
  
  // Reset WebSocket if URL changed
  if (options.websocketUrl !== undefined) {
    if (wsState.socket) {
      wsState.socket.close();
      wsState.socket = null;
    }
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
 */
export const getStatus = () => ({
  connected: wsState.socket?.readyState === WebSocket.OPEN,
  queueLength: wsState.queue.length,
  reconnecting: !!wsState.reconnectTimer
});

// Compatibility exports
export default getLogger;
