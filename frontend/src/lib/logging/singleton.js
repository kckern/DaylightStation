import createLogger, { consoleTransport } from './index';
import { getSharedWsTransport } from './sharedTransport.js';

let singleton = null;
let cachedOptions = {};

const coerceBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'off', 'no'].includes(normalized)) return false;
    if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
  }
  if (typeof value === 'number') return value !== 0;
  return null;
};

const readWindow = (key, fallback = undefined) => (typeof window !== 'undefined' && key in window ? window[key] : fallback);

const defaultLevel = () => readWindow('DAYLIGHT_LOG_LEVEL', 'info');
const defaultTopic = () => readWindow('DAYLIGHT_LOG_TOPIC', 'logging');

const buildTransports = (opts = {}) => {
  const transports = [];
  const consoleDisabled = coerceBoolean(opts.console) === false;
  if (!consoleDisabled) {
    transports.push(consoleTransport());
  }
  const wsDisabled = coerceBoolean(opts.websocket) === false;
  if (!wsDisabled) {
    // Use shared transport to prevent duplicate connections
    const ws = getSharedWsTransport({
      url: opts.wsUrl || opts.websocketUrl,
      topic: opts.topic || opts.websocketTopic || defaultTopic(),
      maxQueue: opts.wsMaxQueue || opts.websocketMaxQueue,
      batchSize: opts.wsBatchSize || opts.websocketBatchSize,
      flushInterval: opts.wsFlushInterval || opts.websocketFlushInterval
    });
    if (ws) transports.push(ws);
  }
  return transports;
};

const noopLogger = () => ({
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger()
});

const resolveOptions = (overrides = {}) => ({
  name: 'frontend',
  level: overrides.level || cachedOptions.level || defaultLevel(),
  context: { app: 'daylight-frontend', ...(cachedOptions.context || {}), ...(overrides.context || {}) },
  sampling: overrides.sampling || cachedOptions.sampling,
  transports: overrides.transports || cachedOptions.transports,
  formatter: overrides.formatter || cachedOptions.formatter,
  topic: overrides.topic || cachedOptions.topic,
  console: overrides.console ?? cachedOptions.console,
  websocket: overrides.websocket ?? cachedOptions.websocket,
  wsUrl: overrides.wsUrl || overrides.websocketUrl || cachedOptions.wsUrl || cachedOptions.websocketUrl,
  wsMaxQueue: overrides.wsMaxQueue || overrides.websocketMaxQueue || cachedOptions.wsMaxQueue || cachedOptions.websocketMaxQueue
});

const isDisabled = (opts = {}) => coerceBoolean(opts.disabled ?? cachedOptions.disabled ?? readWindow('DAYLIGHT_LOGGER_DISABLED')) === true;

export const configureDaylightLogger = (options = {}) => {
  cachedOptions = { ...cachedOptions, ...options };
  singleton = null;
  return getDaylightLogger();
};

export const getDaylightLogger = (overrides = {}) => {
  if (singleton && !Object.keys(overrides || {}).length) {
    return singleton;
  }
  const opts = resolveOptions(overrides);
  if (isDisabled(opts)) {
    singleton = noopLogger();
    return singleton;
  }
  const transports = opts.transports || buildTransports(opts);
  singleton = createLogger({
    name: opts.name,
    level: opts.level,
    context: opts.context,
    sampling: opts.sampling,
    transports,
    formatter: opts.formatter
  });
  return singleton;
};

export const getChildLogger = (context = {}) => getDaylightLogger().child(context);

export default getDaylightLogger;
