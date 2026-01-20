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
  let queue = [];

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
    
    while (queue.length) {
      const payload = queue.shift();
      try {
        ws.send(payload);
      } catch (err) {
        devOutput('warn', '[DaylightLogger] WS send failed', err);
        break;
      }
    }
  };

  return {
    name: 'ws',
    send: (evt) => {
      const payload = { topic, event: evt };
      if (maxQueue > 0) {
        if (queue.length >= maxQueue) queue.shift();
        queue.push(payload);
      }
      flush();
    }
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
  let queue = [];
  let flushTimer = null;

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
    if (!queue.length) return;
    const batch = queue.splice(0, batchSize);
    await sendBatch(batch);
    if (queue.length) {
      // keep flushing until drained
      flush();
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
      if (maxQueue > 0) {
        if (queue.length >= maxQueue) queue.shift();
        queue.push({ event: evt });
      }
      if (queue.length >= batchSize) {
        flush();
      } else {
        scheduleFlush();
      }
    }
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

export { createLogger, consoleTransport, createWebSocketTransport, createBufferingWebSocketTransport };
export default createLogger;
