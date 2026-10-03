const DEFAULTS = Object.freeze({
  handshakeTimeoutMs: 10_000,
  heartbeatPingMs: 5_000,
  heartbeatDeadMs: 20_000,
  watchdogIntervalMs: 30_000,
  reconnectMaxMs: 30_000,
  exitAfterMs: 120_000,
});

export function buildBridgeHealth(websocket) {
  return {
    httpStatus: websocket.connected ? 200 : 503,
    body: {
      status: websocket.connected ? 'healthy' : 'unhealthy',
      websocket,
    },
  };
}

/**
 * Own one recoverable WebSocket connection.
 *
 * Timers and socket construction are injected so every failure state can be
 * driven deterministically in tests. `onOpen` is part of readiness: if the
 * caller cannot subscribe, the connection is rejected and retried.
 */
export function createWebSocketSupervisor({
  url,
  createSocket,
  socketStates,
  onOpen,
  onMessage,
  logger = console,
  now = Date.now,
  timers = globalThis,
  exit = (code) => process.exit(code),
  ...configured
}) {
  const options = { ...DEFAULTS, ...configured };
  let socket = null;
  let generation = 0;
  let phase = 'idle';
  let attempts = 0;
  let outageStartedAt = null;
  let reconnectTimer = null;
  let handshakeTimer = null;
  let heartbeatTimer = null;
  let watchdogTimer = null;
  let exitTimer = null;
  let stopped = false;
  let exitInvoked = false;

  function clearHandshake() {
    if (handshakeTimer != null) timers.clearTimeout(handshakeTimer);
    handshakeTimer = null;
  }

  function clearReconnect() {
    if (reconnectTimer != null) timers.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function clearHeartbeat() {
    if (heartbeatTimer != null) timers.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function beginOutage() {
    if (outageStartedAt == null) outageStartedAt = now();
    if (exitTimer != null || exitInvoked) return;
    exitTimer = timers.setTimeout(() => {
      exitTimer = null;
      if (stopped || outageStartedAt == null || exitInvoked) return;
      exitInvoked = true;
      logger.error?.('WebSocket unavailable for 120s; exiting for container recovery');
      exit(1);
    }, options.exitAfterMs);
  }

  function endOutage() {
    outageStartedAt = null;
    exitInvoked = false;
    if (exitTimer != null) timers.clearTimeout(exitTimer);
    exitTimer = null;
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer != null) return;
    beginOutage();
    phase = 'retrying';
    const delay = Math.min(options.reconnectMaxMs, 1000 * (2 ** attempts));
    attempts += 1;
    logger.warn?.(`WebSocket reconnect scheduled in ${delay}ms (attempt ${attempts})`);
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function rejectCurrent(ws, ownedGeneration, reason) {
    if (stopped || ownedGeneration !== generation || socket !== ws) return;
    clearHandshake();
    clearHeartbeat();
    socket = null;
    logger.warn?.(`WebSocket ${reason}`);
    scheduleReconnect();
    if (ws.readyState !== socketStates.CLOSED && ws.readyState !== socketStates.CLOSING) {
      try { ws.terminate(); } catch { /* retry is already scheduled */ }
    }
  }

  function connect() {
    if (stopped) return;
    clearReconnect();
    clearHandshake();
    const ownedGeneration = ++generation;
    let ws;
    try {
      ws = createSocket(url);
    } catch (error) {
      socket = null;
      logger.error?.(`WebSocket construction failed: ${error.message}`);
      scheduleReconnect();
      return;
    }
    socket = ws;
    phase = 'connecting';
    beginOutage();

    handshakeTimer = timers.setTimeout(() => {
      if (ownedGeneration !== generation || socket !== ws || ws.readyState !== socketStates.CONNECTING) return;
      rejectCurrent(ws, ownedGeneration, `handshake timed out after ${options.handshakeTimeoutMs}ms`);
    }, options.handshakeTimeoutMs);

    let lastHeardAt = now();
    ws.on('pong', () => {
      if (ownedGeneration === generation) lastHeardAt = now();
    });
    ws.on('message', (message) => {
      if (ownedGeneration !== generation || socket !== ws) return;
      lastHeardAt = now();
      onMessage(message);
    });
    ws.on('open', () => {
      if (ownedGeneration !== generation || socket !== ws) return;
      clearHandshake();
      try {
        onOpen(ws);
      } catch (error) {
        logger.error?.(`WebSocket setup failed: ${error.message}`);
        rejectCurrent(ws, ownedGeneration, 'setup failed');
        return;
      }
      phase = 'open';
      attempts = 0;
      lastHeardAt = now();
      endOutage();
      clearHeartbeat();
      heartbeatTimer = timers.setInterval(() => {
        if (ownedGeneration !== generation || socket !== ws) return;
        if (ws.readyState !== socketStates.OPEN) return;
        const silentMs = now() - lastHeardAt;
        if (silentMs > options.heartbeatDeadMs) {
          rejectCurrent(ws, ownedGeneration, `silent for ${Math.round(silentMs / 1000)}s`);
          return;
        }
        try { ws.ping(); } catch (error) {
          rejectCurrent(ws, ownedGeneration, `ping failed: ${error.message}`);
        }
      }, options.heartbeatPingMs);
      logger.info?.('WebSocket connection operational');
    });
    ws.on('error', (error) => {
      if (ownedGeneration !== generation || socket !== ws) return;
      logger.error?.(`WebSocket error: ${error.message}`);
      rejectCurrent(ws, ownedGeneration, 'connection failed');
    });
    ws.on('close', () => {
      if (ownedGeneration !== generation || socket !== ws) return;
      rejectCurrent(ws, ownedGeneration, 'connection closed');
    });
  }

  function start() {
    if (stopped || phase !== 'idle') return;
    connect();
    watchdogTimer = timers.setInterval(() => {
      if (stopped) return;
      const open = socket?.readyState === socketStates.OPEN && phase === 'open';
      const connecting = socket?.readyState === socketStates.CONNECTING && handshakeTimer != null;
      if (open || connecting || reconnectTimer != null) return;
      logger.warn?.('WebSocket watchdog found stalled recovery; reconnecting');
      connect();
    }, options.watchdogIntervalMs);
  }

  function stop() {
    stopped = true;
    phase = 'stopped';
    generation += 1;
    clearHandshake();
    clearReconnect();
    clearHeartbeat();
    if (watchdogTimer != null) timers.clearInterval(watchdogTimer);
    watchdogTimer = null;
    if (exitTimer != null) timers.clearTimeout(exitTimer);
    exitTimer = null;
    try { socket?.close(); } catch { /* shutdown best effort */ }
    socket = null;
  }

  function getStatus() {
    return {
      connected: phase === 'open' && socket?.readyState === socketStates.OPEN,
      phase,
      retryScheduled: reconnectTimer != null,
      attempts,
      outageMs: outageStartedAt == null ? 0 : Math.max(0, now() - outageStartedAt),
    };
  }

  return { start, stop, getClient: () => socket, getStatus };
}
