import { performance } from 'node:perf_hooks';

/** Receipt means the ANT+/BLE manager invoked the shared sample callback. */
export function createDataPathHealth({ bootId, now = () => performance.now() }) {
  let sourceSeq = 0;
  let sentCount = 0;
  let lastSourceAt = null;
  return {
    received() {
      sourceSeq += 1;
      lastSourceAt = now();
      return { bootId, sourceSeq };
    },
    // A successful local WebSocket write is not proof of backend/browser receipt.
    sent() { sentCount += 1; },
    snapshot(socketPhase = 'unknown') {
      return {
        protocol: 1, bootId, sourceSeq, receivedCount: sourceSeq, sentCount,
        lastSourceAgeMs: lastSourceAt == null ? null : Math.max(0, now() - lastSourceAt),
        socketPhase,
      };
    },
  };
}

/** The server and synthetic relay tests use this same real sample boundary. */
export function createFitnessDataBroadcaster({ health, getSocket, openState, logEvent = () => {} }) {
  return function broadcastFitnessData(message) {
    const metadata = health.received();
    const socket = getSocket();
    if (!socket || socket.readyState !== openState) return;
    const failed = () => {
      try { logEvent('warn', 'fitness.transport.send_failed', metadata); }
      catch { /* The structured log transport may share the failed socket. */ }
    };
    try {
      socket.send(JSON.stringify({ ...message, ...metadata }), (error) => {
        if (error) failed();
        else health.sent();
      });
    } catch {
      failed();
    }
  };
}
