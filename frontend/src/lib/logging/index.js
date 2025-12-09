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
    url = null,
    topic = 'logging',
    maxQueue = 200,
    reconnectBaseDelay = 800,
    reconnectMaxDelay = 6000
  } = options;

  let socket = null;
  let connecting = false;
  let queue = [];
  let reconnectDelay = reconnectBaseDelay;
  let timer = null;

  const resolveUrl = () => {
    if (url) return url;
    if (!window.location?.origin) return null;
    return window.location.origin.replace(/^http/, 'ws') + '/ws';
  };

  const flush = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    while (queue.length) {
      const payload = queue.shift();
      try {
        socket.send(JSON.stringify(payload));
      } catch (err) {
        devOutput('warn', '[DaylightLogger] WS send failed', err);
        break;
      }
    }
  };

  const scheduleReconnect = () => {
    if (timer) return;
    const delay = Math.min(reconnectDelay, reconnectMaxDelay);
    timer = setTimeout(() => {
      timer = null;
      reconnectDelay = Math.min(delay * 2, reconnectMaxDelay);
      ensure();
    }, delay);
  };

  const ensure = () => {
    if (connecting) return;
    const target = resolveUrl();
    if (!target) return;
    connecting = true;
    try {
      socket = new WebSocket(target);
      socket.onopen = () => {
        connecting = false;
        reconnectDelay = reconnectBaseDelay;
        flush();
      };
      socket.onclose = () => {
        connecting = false;
        socket = null;
        scheduleReconnect();
      };
      socket.onerror = () => {
        connecting = false;
        socket = null;
        scheduleReconnect();
      };
    } catch (err) {
      connecting = false;
      socket = null;
      scheduleReconnect();
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
      ensure();
      flush();
    }
  };
}

// Buffering transport that batches events before sending over WebSocket
function createBufferingWebSocketTransport(options = {}) {
  if (typeof window === 'undefined') return null;

  const {
    url = null,
    topic = 'logging',
    maxQueue = 500,
    reconnectBaseDelay = 800,
    reconnectMaxDelay = 6000,
    batchSize = 20,
    flushInterval = 1000
  } = options;

  let socket = null;
  let connecting = false;
  let queue = [];
  let reconnectDelay = reconnectBaseDelay;
  let timer = null;

  const resolveUrl = () => {
    if (url) return url;
    if (!window.location?.origin) return null;
    return window.location.origin.replace(/^http/, 'ws') + '/ws';
  };

  const sendBatch = (batch) => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !batch.length) return;
    try {
      socket.send(JSON.stringify({ topic, events: batch }));
    } catch (err) {
      devOutput('warn', '[DaylightLogger] WS batch send failed', err);
    }
  };

  const flush = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!queue.length) return;
    const batch = queue.splice(0, batchSize);
    sendBatch(batch);
    if (queue.length) {
      // keep flushing until drained or socket closes
      flush();
    }
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, flushInterval);
  };

  const scheduleReconnect = () => {
    if (timer) return; // let flush timer handle immediate retries
    const delay = Math.min(reconnectDelay, reconnectMaxDelay);
    timer = setTimeout(() => {
      timer = null;
      reconnectDelay = Math.min(delay * 2, reconnectMaxDelay);
      ensure();
    }, delay);
  };

  const ensure = () => {
    if (connecting) return;
    const target = resolveUrl();
    if (!target) return;
    connecting = true;
    try {
      socket = new WebSocket(target);
      socket.onopen = () => {
        connecting = false;
        reconnectDelay = reconnectBaseDelay;
        flush();
      };
      socket.onclose = () => {
        connecting = false;
        socket = null;
        scheduleReconnect();
      };
      socket.onerror = () => {
        connecting = false;
        socket = null;
        scheduleReconnect();
      };
    } catch (err) {
      connecting = false;
      socket = null;
      scheduleReconnect();
    }
  };

  return {
    name: 'ws-buffered',
    send: (evt) => {
      if (maxQueue > 0) {
        if (queue.length >= maxQueue) queue.shift();
        queue.push({ event: evt });
      }
      ensure();
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
