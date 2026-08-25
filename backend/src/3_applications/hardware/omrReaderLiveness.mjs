// backend/src/3_applications/hardware/omrReaderLiveness.mjs
//
// Liveness check for the OMR relay's card readers, sibling to
// relayWatchdog.mjs (no-traffic silence) but for a different failure mode.
//
// Incident (2026-08-25): a reader flapped, and on some reconnects the
// backend held a live WS socket for it that never subscribed to its topic.
// In that state the backend has a connection, the reader believes it is
// online, and a scan produces NO backend event at all — nobody learns
// anything until a child is standing at the printer holding a card that did
// nothing. relayWatchdog deliberately does not cover the OMR reader (it is
// "used a few times a term", so hours of silence is normal); this checks a
// narrower, always-abnormal signature instead: a connection that survives
// past the healthy handshake window without completing it.
//
// The firmware (`_extensions/omr-relay/firmware/src/main.cpp`, `onWsEvent`'s
// `WStype_CONNECTED` case) subscribes to its own bus topic immediately on
// connect, synchronously, before anything else — a healthy board subscribes
// within milliseconds. A CONNECTED socket that is still unsubscribed a few
// seconds later did not complete that handshake and is, for all practical
// purposes, deaf: nothing it receives (the round-trip ack) or sends
// thereafter can be relied on to reach anyone.
//
// IDENTIFYING THE READER: a deaf connection has usually sent nothing at all
// (the same connected-handler code path that failed to subscribe also
// carries the "who am I" hello), so this cannot learn a reader's id from the
// deaf connection itself. Instead it remembers, by IP, the last reader id
// seen on a HEALTHY connection (an inbound `source: 'omr-relay'` message),
// and only warns about a later deaf connection when that IP is already a
// KNOWN reader. An IP this service has never heard from has nothing
// actionable to name, so it is left alone rather than guessed at — that is
// also what keeps this from firing on every other WS client (browsers,
// MIDI bridges, other hardware relays) that happens to connect without
// immediately subscribing to something.
//
// Layering note: `onClientSubscription` is a new hook on IEventBus /
// WebSocketEventBus, added alongside the existing onClientConnection /
// onClientMessage / onClientDisconnection triad — a subscribe command
// (`bus_command`) is intercepted before the generic message-handler list,
// so there was previously no way for application code to observe it at all.

const DEFAULT_GRACE_MS = 5000;
const DEFAULT_SOURCE = 'omr-relay';

/**
 * @param {object} deps
 * @param {object} deps.eventBus - needs onClientConnection, onClientSubscription,
 *   onClientMessage, onClientDisconnection
 * @param {number} [deps.graceMs] - how long a connection may stay unsubscribed
 *   before it is considered deaf (a healthy board subscribes in milliseconds)
 * @param {string} [deps.source] - the ingest `source` value that identifies an
 *   OMR relay message (matches omrRelay.mjs's RELAY_SOURCE)
 * @param {{now: () => number}} [deps.clock]
 * @param {object} [deps.logger]
 * @returns {{ check: (nowMs?: number) => void }}
 */
export function createOmrReaderLiveness({
  eventBus, graceMs = DEFAULT_GRACE_MS, source = DEFAULT_SOURCE, clock = Date, logger = console,
} = {}) {
  if (!eventBus?.onClientConnection || !eventBus?.onClientSubscription
      || !eventBus?.onClientMessage || !eventBus?.onClientDisconnection) {
    throw new Error(
      'createOmrReaderLiveness: eventBus with onClientConnection/onClientSubscription/'
      + 'onClientMessage/onClientDisconnection required',
    );
  }

  // ip -> reader id, learned only from a message that proves the reader at
  // that address is alive and identified. Never cleared on disconnect: it is
  // exactly what lets a LATER, silent reconnect from the same board still be
  // named.
  const readerIdByIp = new Map();

  // clientId -> { ip, connectedAt, cleared, warned }. `cleared` means this
  // connection has proven it is NOT the deaf state — either it subscribed,
  // or it has sent at least one ingest message (which the relay already
  // broadcasts/persists regardless of that connection's own subscription,
  // so a message-sending-but-unsubscribed client is not the invisible-scan
  // failure this service exists to catch). Removed on disconnect — a
  // connection's own pending state does not outlive it, so a fresh reconnect
  // always starts with a clean slate (and a fresh grace window) even if the
  // previous one never cleared.
  const pending = new Map();

  eventBus.onClientConnection((clientId, meta) => {
    pending.set(clientId, {
      ip: meta?.ip ?? null,
      connectedAt: clock.now(),
      cleared: false,
      warned: false,
    });
  });

  eventBus.onClientSubscription((clientId) => {
    const entry = pending.get(clientId);
    if (entry) entry.cleared = true;
  });

  eventBus.onClientMessage((clientId, message) => {
    if (message?.source !== source) return;
    const entry = pending.get(clientId);
    const ip = entry?.ip;
    if (ip && typeof message.id === 'string' && message.id) readerIdByIp.set(ip, message.id);
    // A message on the ingest path proves this connection is talking to us,
    // regardless of subscription state.
    if (entry) entry.cleared = true;
  });

  eventBus.onClientDisconnection((clientId) => {
    pending.delete(clientId);
  });

  /**
   * Scan every still-pending connection for one that has outlived the grace
   * period without subscribing (or otherwise proving it is alive), and warn
   * once per such connection. Called on a short interval by the composition
   * root — NOT rate-limited beyond that "once per connection" latch: a
   * genuine change (a new deaf connection) always produces a new line.
   */
  function check(nowMs = clock.now()) {
    for (const [clientId, entry] of pending) {
      if (entry.cleared || entry.warned) continue;
      const sinceMs = nowMs - entry.connectedAt;
      if (sinceMs < graceMs) continue;
      const id = entry.ip ? readerIdByIp.get(entry.ip) : null;
      // Nothing to name yet (an IP never seen on a healthy connection) —
      // not actionable, and naming it "unknown" would be a guess dressed up
      // as a diagnosis.
      if (!id) continue;
      entry.warned = true;
      logger.warn?.('omr.reader_liveness.deaf', { id, clientId, ip: entry.ip, sinceMs });
    }
  }

  return { check };
}

export default createOmrReaderLiveness;
