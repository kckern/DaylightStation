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

let playerDebugMode = PLAYER_DEBUG_MODE_DEFAULT;
let globalLoggerContext = { ...DEFAULT_CONTEXT };

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
