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
   Note: Now delegates to shared transport
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
}port default getLogger;
uses shared transport)
  if (config.websocketEnabled) {
    const transport = ensureTransport();
    if (transport) {
      transport.send(event);
    }