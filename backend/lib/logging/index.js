// DaylightLogger - Backend core
// Structured logger with pluggable transports

import https from 'https';
import os from 'os';

const LEVELS = ['debug', 'info', 'warn', 'error'];
const LEVEL_PRIORITY = LEVELS.reduce((acc, level, idx) => ({ ...acc, [level]: idx }), {});

const defaultFormatter = (event) => event;

// Single place to resolve Loggly tokens (DRY)
const resolveLogglyToken = () => process.env.LOGGLY_TOKEN || process.env.LOGGLY_INPUT_TOKEN;

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

function logglyTransportAdapter({ token = resolveLogglyToken(), tags = ['daylight'], endpoint = 'logs-01.loggly.com' } = {}) {
  if (!token) {
    return {
      name: 'loggly-null',
      send: () => {
        // noop when token missing
      }
    };
  }

  const tagString = Array.isArray(tags) ? tags.join(',') : String(tags);

  return {
    name: 'loggly',
    send: (evt) => {
      const payload = JSON.stringify(evt);
      const options = {
        hostname: endpoint,
        port: 443,
        path: `/inputs/${token}/tag/${encodeURIComponent(tagString)}/`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      const req = https.request(options, () => {});
      req.on('error', (err) => {
        process.stderr.write(`[DaylightLogger] Loggly transport error: ${err.message}\n`);
      });
      req.write(payload);
      req.end();
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
