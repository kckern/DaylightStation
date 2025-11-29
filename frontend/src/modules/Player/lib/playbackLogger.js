const PLAYER_DEBUG_MODE_DEFAULT = true;
const DEFAULT_LOG_LEVEL = 'debug';
const LOG_LEVEL_PRIORITY = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
});
const DEFAULT_CONTEXT = Object.freeze({ threadId: null, mediaKey: null, sessionId: null });
const OPTION_KEYS = new Set(['level', 'context', 'extra', 'tags', 'sampleRate']);

const DEFAULT_WEBSOCKET_OPTIONS = Object.freeze({
  enabled: false,
  url: null,
  topic: 'playback-log',
  maxQueue: 200,
  reconnectBaseDelay: 1000,
  reconnectMaxDelay: 15000
});

const PLAYBACK_SOCKET_SOURCE = 'playback-logger';
const QUEUE_FALLBACK_LIMIT = 500;

let playerDebugMode = PLAYER_DEBUG_MODE_DEFAULT;
let globalLoggerContext = { ...DEFAULT_CONTEXT };
let websocketOptions = { ...DEFAULT_WEBSOCKET_OPTIONS };

const websocketQueue = [];
const websocketState = {
  socket: null,
  connecting: false,
  reconnectDelay: DEFAULT_WEBSOCKET_OPTIONS.reconnectBaseDelay,
  reconnectTimer: null
};

const defaultFormatter = (record) => {
  const label = `[PlaybackLogger/${record.event}]`;
  const parts = [
    label,
    `level=${record.level.toUpperCase()}`,
    `ts=${new Date(record.timestamp).toISOString()}`
  ];
  const contextEntries = Object.entries(record.context || {}).filter(([, value]) => value != null && value !== '');
  if (contextEntries.length) {
    parts.push(`ctx=${contextEntries.map(([key, value]) => `${key}=${stringifyValue(value)}`).join(' ')}`);
  }
  const payloadString = formatPayload(record.payload);
  if (payloadString) {
    parts.push(payloadString);
  }
  if (typeof record.extra !== 'undefined') {
    const extraString = formatPayload(record.extra);
    if (extraString) {
      parts.push(`extra=${extraString}`);
    }
  }
  if (record.tags?.length) {
    parts.push(`tags=${record.tags.join(',')}`);
  }
  return parts.join(' ');
};

const defaultSink = (record, formatted) => {
  const target = record.level === 'error'
    ? console.error
    : (record.level === 'warn' ? console.warn : console.log);
  target(formatted);
};

const loggerConfig = {
  level: DEFAULT_LOG_LEVEL,
  enabledOverride: null,
  formatter: defaultFormatter,
  sinks: [defaultSink],
  sampling: null,
  random: () => Math.random()
};

const applyWebSocketOptions = (options = {}) => {
  const next = { ...websocketOptions };
  if (typeof options.enabled === 'boolean') {
    next.enabled = options.enabled;
  }
  if (typeof options.url === 'string') {
    const trimmed = options.url.trim();
    next.url = trimmed.length ? trimmed : null;
  }
  if (typeof options.topic === 'string') {
    const trimmed = options.topic.trim();
    if (trimmed.length) {
      next.topic = trimmed;
    }
  }
  if (Number.isFinite(options.maxQueue) && options.maxQueue > 0) {
    next.maxQueue = Math.min(Math.max(Math.floor(options.maxQueue), 25), QUEUE_FALLBACK_LIMIT);
  }
  if (Number.isFinite(options.reconnectBaseDelay) && options.reconnectBaseDelay > 0) {
    next.reconnectBaseDelay = Math.max(250, Math.floor(options.reconnectBaseDelay));
  }
  if (Number.isFinite(options.reconnectMaxDelay) && options.reconnectMaxDelay > 0) {
    next.reconnectMaxDelay = Math.max(next.reconnectBaseDelay, Math.floor(options.reconnectMaxDelay));
  }
  if (next.url && typeof options.enabled === 'undefined') {
    next.enabled = true;
  }
  const changed = JSON.stringify(next) !== JSON.stringify(websocketOptions);
  websocketOptions = next;
  if (changed) {
    teardownWebSocketTransport();
  }
  return websocketOptions;
};

const teardownWebSocketTransport = () => {
  if (typeof window === 'undefined') return;
  try {
    if (websocketState.socket) {
      websocketState.socket.close();
    }
  } catch (_) {
    // ignore close errors
  }
  websocketState.socket = null;
  websocketState.connecting = false;
  if (websocketState.reconnectTimer) {
    clearTimeout(websocketState.reconnectTimer);
    websocketState.reconnectTimer = null;
  }
  websocketState.reconnectDelay = websocketOptions.reconnectBaseDelay;
};

const shouldUseWebSocketTransport = () => (
  typeof window !== 'undefined'
  && typeof window.WebSocket === 'function'
  && websocketOptions.enabled
);

const resolveWebSocketUrl = () => {
  if (websocketOptions.url) {
    return websocketOptions.url;
  }
  if (typeof window === 'undefined' || !window.location) {
    return null;
  }
  const origin = window.location.origin || '';
  if (!origin) {
    return null;
  }
  return `${origin.replace(/^http/, 'ws')}/ws`;
};

const enqueueWebSocketPayload = (payload) => {
  if (!websocketOptions.maxQueue) {
    return;
  }
  while (websocketQueue.length >= websocketOptions.maxQueue) {
    websocketQueue.shift();
  }
  websocketQueue.push(payload);
};

const flushWebSocketQueue = () => {
  if (!shouldUseWebSocketTransport()) {
    websocketQueue.length = 0;
    return;
  }
  if (!websocketState.socket || websocketState.socket.readyState !== window.WebSocket.OPEN) {
    return;
  }
  while (websocketQueue.length) {
    const payload = websocketQueue.shift();
    try {
      websocketState.socket.send(JSON.stringify(payload));
    } catch (error) {
      console.warn('[PlaybackLogger] WebSocket send failed', error);
      break;
    }
  }
};

const scheduleWebSocketReconnect = () => {
  if (!shouldUseWebSocketTransport()) {
    return;
  }
  if (websocketState.reconnectTimer) {
    return;
  }
  const delay = Math.min(
    websocketState.reconnectDelay || websocketOptions.reconnectBaseDelay,
    websocketOptions.reconnectMaxDelay
  );
  websocketState.reconnectTimer = setTimeout(() => {
    websocketState.reconnectTimer = null;
    websocketState.reconnectDelay = Math.min(delay * 2, websocketOptions.reconnectMaxDelay);
    ensureWebSocketTransport();
  }, delay);
};

const ensureWebSocketTransport = () => {
  if (!shouldUseWebSocketTransport()) {
    return;
  }
  if (websocketState.socket) {
    const readyState = websocketState.socket.readyState;
    if (readyState === window.WebSocket.OPEN) {
      flushWebSocketQueue();
      return;
    }
    if (readyState === window.WebSocket.CONNECTING) {
      return;
    }
  }
  if (websocketState.connecting) {
    return;
  }
  const targetUrl = resolveWebSocketUrl();
  if (!targetUrl) {
    return;
  }
  try {
    websocketState.connecting = true;
    const socket = new window.WebSocket(targetUrl);
    websocketState.socket = socket;
    socket.onopen = () => {
      websocketState.connecting = false;
      websocketState.reconnectDelay = websocketOptions.reconnectBaseDelay;
      flushWebSocketQueue();
    };
    socket.onclose = () => {
      websocketState.connecting = false;
      websocketState.socket = null;
      scheduleWebSocketReconnect();
    };
    socket.onerror = () => {
      websocketState.connecting = false;
      websocketState.socket = null;
      scheduleWebSocketReconnect();
    };
  } catch (error) {
    websocketState.connecting = false;
    websocketState.socket = null;
    console.warn('[PlaybackLogger] Failed to open WebSocket', error);
    scheduleWebSocketReconnect();
  }
};

const maybeSendToPlaybackWebSocket = (record) => {
  if (!shouldUseWebSocketTransport()) {
    return;
  }
  const payload = {
    topic: websocketOptions.topic || 'playback-log',
    source: PLAYBACK_SOCKET_SOURCE,
    level: record.level,
    event: record.event,
    timestamp: record.timestamp,
    context: record.context,
    payload: record.payload,
    extra: record.extra,
    tags: record.tags
  };
  enqueueWebSocketPayload(payload);
  ensureWebSocketTransport();
  flushWebSocketQueue();
};

const coerceBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'false' || normalized === '0' || normalized === 'off') {
      return false;
    }
    if (normalized === 'true' || normalized === '1' || normalized === 'on') {
      return true;
    }
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  return Boolean(value);
};

const readWindowDebugFlag = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  if (typeof window.PLAYER_DEBUG_MODE === 'undefined') {
    return null;
  }
  return coerceBoolean(window.PLAYER_DEBUG_MODE);
};

const initialWindowFlag = readWindowDebugFlag();
if (typeof initialWindowFlag === 'boolean') {
  playerDebugMode = initialWindowFlag;
}

const normalizeLevel = (level) => {
  const key = String(level || '').toLowerCase();
  if (LOG_LEVEL_PRIORITY[key] != null) {
    return key;
  }
  return 'info';
};

const readWindowLogLevel = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  const candidate = window.PLAYER_LOG_LEVEL || window.playerLogLevel || null;
  if (!candidate) {
    return null;
  }
  return normalizeLevel(candidate);
};

const initialWindowLogLevel = readWindowLogLevel();
if (initialWindowLogLevel) {
  loggerConfig.level = initialWindowLogLevel;
}

const isLoggingEnabled = () => {
  if (typeof loggerConfig.enabledOverride === 'boolean') {
    return loggerConfig.enabledOverride;
  }
  return playerDebugMode;
};

const shouldLog = (level) => {
  if (!isLoggingEnabled()) return false;
  const normalizedLevel = normalizeLevel(level);
  return LOG_LEVEL_PRIORITY[normalizedLevel] >= LOG_LEVEL_PRIORITY[normalizeLevel(loggerConfig.level)];
};

const clampUnitInterval = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
};

const resolveSamplingDecision = (rule, event, randomFn) => {
  if (rule == null) return true;
  if (typeof rule === 'function') {
    try {
      const result = rule(event);
      if (typeof result === 'boolean') return result;
      const normalizedFnRate = clampUnitInterval(result);
      if (normalizedFnRate == null) return true;
      if (normalizedFnRate === 0) return false;
      if (normalizedFnRate === 1) return true;
      return randomFn() < normalizedFnRate;
    } catch (error) {
      console.warn('[PlaybackLogger] sampler failed', error);
      return true;
    }
  }
  const rate = (() => {
    if (typeof rule === 'number') {
      return clampUnitInterval(rule);
    }
    if (rule && typeof rule === 'object') {
      const scoped = rule[event];
      if (typeof scoped === 'number') {
        return clampUnitInterval(scoped);
      }
      if (typeof rule['*'] === 'number') {
        return clampUnitInterval(rule['*']);
      }
    }
    return null;
  })();
  if (rate == null) return true;
  if (rate === 0) return false;
  if (rate === 1) return true;
  return randomFn() < rate;
};

const shouldSampleRecord = (event, overrideRate) => {
  const randomFn = typeof loggerConfig.random === 'function' ? loggerConfig.random : Math.random;
  if (typeof overrideRate === 'boolean') {
    return overrideRate;
  }
  const normalizedOverride = clampUnitInterval(overrideRate);
  if (normalizedOverride != null) {
    if (normalizedOverride === 0) return false;
    if (normalizedOverride === 1) return true;
    return randomFn() < normalizedOverride;
  }
  return resolveSamplingDecision(loggerConfig.sampling, event, randomFn);
};

const serializePayload = (payload) => {
  if (payload instanceof Error) {
    return {
      message: payload.message,
      stack: payload.stack
    };
  }
  return payload;
};

const stringifyValue = (value) => {
  if (value == null) return String(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((entry, index) => `${index}:${stringifyValue(entry)}`).join(',');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => `${key}=${stringifyValue(entry)}`)
      .join(' ');
  }
  return String(value);
};

const formatPayload = (payload) => {
  if (payload == null) {
    return '';
  }
  return stringifyValue(payload);
};

const mergeContext = (context = {}) => ({
  ...globalLoggerContext,
  ...(typeof context === 'function' ? context(globalLoggerContext) : context)
});

const emitLogRecord = (record) => {
  const formatted = loggerConfig.formatter(record);
  loggerConfig.sinks.forEach((sink) => {
    try {
      sink(record, formatted);
    } catch (error) {
      // Avoid recursive logging
      console.warn('[PlaybackLogger] sink failed', error);
    }
  });
  maybeSendToPlaybackWebSocket(record);
};

const looksLikeOptionsBag = (value) => (
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && Array.from(OPTION_KEYS).some((key) => Object.prototype.hasOwnProperty.call(value, key))
);

const logInternal = (level, event, payload, options = {}) => {
  const normalizedLevel = normalizeLevel(level);
  if (!shouldLog(normalizedLevel)) {
    return;
  }
  if (!shouldSampleRecord(event, options.sampleRate)) {
    return;
  }

  const record = {
    timestamp: Date.now(),
    level: normalizedLevel,
    event,
    payload: serializePayload(payload),
    extra: typeof options.extra === 'undefined' ? undefined : serializePayload(options.extra),
    context: mergeContext(options.context),
    tags: Array.isArray(options.tags) ? options.tags.filter(Boolean) : undefined
  };

  emitLogRecord(record);
};

export const PLAYER_DEBUG_MODE = PLAYER_DEBUG_MODE_DEFAULT;

export const getPlayerDebugMode = () => playerDebugMode;

export const isPlayerDebugModeEnabled = () => getPlayerDebugMode();

export const setPlayerDebugMode = (value) => {
  playerDebugMode = coerceBoolean(value);
  if (typeof window !== 'undefined') {
    window.PLAYER_DEBUG_MODE = playerDebugMode;
  }
  return playerDebugMode;
};

export const configurePlaybackLogger = (options = {}) => {
  if (typeof options.level === 'string' && LOG_LEVEL_PRIORITY[options.level.toLowerCase()] != null) {
    loggerConfig.level = options.level.toLowerCase();
  }
  if (typeof options.enabled === 'boolean') {
    loggerConfig.enabledOverride = options.enabled;
  }
  if (typeof options.formatter === 'function') {
    loggerConfig.formatter = options.formatter;
  }
  if (Array.isArray(options.sinks) && options.sinks.length) {
    loggerConfig.sinks = options.sinks;
  } else if (typeof options.sink === 'function') {
    loggerConfig.sinks = [options.sink];
  }
  if (typeof options.random === 'function') {
    loggerConfig.random = options.random;
  }
  if (typeof options.sampling !== 'undefined') {
    loggerConfig.sampling = options.sampling;
  }
  if (options.websocket) {
    applyWebSocketOptions(options.websocket);
  }
  return { ...loggerConfig };
};

export const setPlaybackLoggerContext = (context = {}) => {
  if (!context || typeof context !== 'object') {
    return { ...globalLoggerContext };
  }
  globalLoggerContext = {
    ...globalLoggerContext,
    ...context
  };
  return { ...globalLoggerContext };
};

export const resetPlaybackLoggerContext = () => {
  globalLoggerContext = { ...DEFAULT_CONTEXT };
  return { ...globalLoggerContext };
};

export const createPlaybackLogger = (baseContext = {}) => {
  const base = { ...baseContext };
  const withBaseContext = (options = {}) => ({
    ...options,
    context: {
      ...base,
      ...(options.context || {})
    }
  });
  return {
    debug: (event, payload, options) => logInternal('debug', event, payload, withBaseContext(options)),
    info: (event, payload, options) => logInternal('info', event, payload, withBaseContext(options)),
    warn: (event, payload, options) => logInternal('warn', event, payload, withBaseContext(options)),
    error: (event, payload, options) => logInternal('error', event, payload, withBaseContext(options)),
    log: (event, payload, options) => logInternal('info', event, payload, withBaseContext(options))
  };
};

export function playbackLog(event, payload, extraOrOptions) {
  const options = looksLikeOptionsBag(extraOrOptions)
    ? { ...extraOrOptions }
    : { extra: extraOrOptions };
  logInternal(options.level || 'info', event, payload, options);
}

export default playbackLog;
