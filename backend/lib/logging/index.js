// DaylightLogger - Backend core
// Structured logger with pluggable transports

import os from 'os';
import winston from 'winston';
import { Loggly } from 'winston-loggly-bulk';

const LEVELS = ['debug', 'info', 'warn', 'error'];
const LEVEL_PRIORITY = LEVELS.reduce((acc, level, idx) => ({ ...acc, [level]: idx }), {});

// Cache winston loggers per tag signature so multiple modules reuse a single transport
const logglyLoggerCache = new Map();

const defaultFormatter = (event) => event;

// Single place to resolve Loggly tokens (DRY)
const resolveLogglyToken = () => process.env.LOGGLY_TOKEN || process.env.LOGGLY_INPUT_TOKEN;
const resolveLogglySubdomain = () => process.env.LOGGLY_SUBDOMAIN || process.env.LOGGLY_SUB_DOMAIN;

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

function consoleTransport() {
  return {
    name: 'console',
    send: (evt) => {
      const line = `[DaylightLogger] ${JSON.stringify(evt)}\n`;
      if (evt.level === 'error') {
        process.stderr.write(line);
      } else if (evt.level === 'warn') {
        process.stderr.write(line);
      } else {
        process.stdout.write(line);
      }
    }
  };
}

function winstonTransportAdapter(winstonLogger) {
  return {
    name: 'winston',
    send: (evt) => {
      if (!winstonLogger || typeof winstonLogger.log !== 'function') return;
      const { level, event, message, ...rest } = evt;
      winstonLogger.log(level, message || event, { event, ...rest });
    }
  };
}

function logglyTransportAdapter({ token = resolveLogglyToken(), subdomain = resolveLogglySubdomain(), tags = ['daylight'], endpoint = 'logs-01.loggly.com' } = {}) {
  if (!token) {
    return {
      name: 'loggly-null',
      send: () => {
        // noop when token missing
      }
    };
  }

  const tagString = Array.isArray(tags) ? tags.join(',') : String(tags);
  const cacheKey = `${subdomain || endpoint}|${tagString}|${token}`;

  // Create or reuse a cached winston logger with Loggly bulk transport
  const getOrCreateWinstonLogger = () => {
    if (logglyLoggerCache.has(cacheKey)) return logglyLoggerCache.get(cacheKey);

    const transports = [
      new Loggly({
        token,
        subdomain: subdomain || endpoint.replace('.loggly.com', ''),
        tags,
        json: true,
        endpoint,
        networkErrorsOnConsole: true,
        bufferOptions: { size: 1, retriesInMilliSeconds: 1000 }
      })
    ];

    // Use a simple JSON logger; we rely on upstream to shape the event
    const logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports
    });

    logglyLoggerCache.set(cacheKey, logger);
    return logger;
  };

  const logger = getOrCreateWinstonLogger();

  return {
    name: 'loggly',
    send: (evt) => {
      // Preserve incoming level if present; fallback to info
      const level = typeof evt?.level === 'string' ? evt.level.toLowerCase() : 'info';
      // Winston requires a message; use event name or a fallback
      const message = evt?.event || evt?.message || 'log-event';

      logger.log({ level, message, ...evt });
    }
  };
}

function createLogger({ name = 'backend', context = {}, level = 'info', transports = [consoleTransport()], formatter = defaultFormatter, sampling = null } = {}) {
  const baseContext = { logger: name, host: os.hostname(), ...context };

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
      source: options.source || 'backend'
    };
    validateEvent(evt);
    const formatted = formatter(evt);
    transports.filter(Boolean).forEach((t) => {
      try {
        t.send(formatted);
      } catch (err) {
        const warnLine = `[DaylightLogger] transport failure ${t.name}: ${err?.message || err}\n`;
        process.stderr.write(warnLine);
      }
    });
  };

  const child = (childContext = {}) => createLogger({ name, context: { ...baseContext, ...childContext }, level, transports, formatter, sampling });

  return {
    log: emit,
    debug: (eventName, data, opts) => emit('debug', eventName, data, opts),
    info: (eventName, data, opts) => emit('info', eventName, data, opts),
    warn: (eventName, data, opts) => emit('warn', eventName, data, opts),
    error: (eventName, data, opts) => emit('error', eventName, data, opts),
    child
  };
}

export { createLogger, consoleTransport, winstonTransportAdapter, logglyTransportAdapter };
export { resolveLogglyToken };
export default createLogger;
