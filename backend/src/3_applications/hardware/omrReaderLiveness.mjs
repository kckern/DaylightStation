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
// "used a few times a term", so hours of silence is normal); this checks
// narrower, always-abnormal signatures instead. There are two:
//
//   DEAF     a connection that survives past the healthy handshake window
//            without completing it — described immediately below.
//   FLAPPING a reader that reconnects repeatedly in a short window. Each
//            individual connection is fine, so neither the deaf check nor
//            anything else notices; the fault is only in the RATE. This is
//            what the OMR-1100 showed on 2026-08-25 while a child's sheet
//            failed to feed three times — a suspected brownout, where NFC
//            reads (no motor) kept working and the motor-driven feed did not,
//            and the device's own HTTP status server was unreachable. See
//            DEFAULT_BURST_* below for how that day's numbers set the
//            thresholds. The burst warning also carries the reader's own
//            `last_reset` / `boot_count` when its firmware reports them, which
//            is what turns that suspicion into an answer — see bootInfoByIp.
//
// DETECTION ONLY. Neither check attempts a remedy: what is being caught here
// is a hardware fault, and the useful thing software can do about it is say
// so, at a level that actually reaches the log store, so the next person does
// not have to reconstruct it from a child's account.
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

// ---- Reconnect-burst thresholds ----------------------------------------
//
// The second always-abnormal signature, and the one that was visible (but
// unflagged) while a child's scan failed three times on 2026-08-25: the reader
// keeps dropping and re-establishing its socket. Each individual connection
// looks perfectly healthy — it connects, subscribes, and answers — so the deaf
// check above never fires. The fault is only in the RATE.
//
// The numbers below are read off that day's `omr.relay.status` lines (the relay
// announces its queue on every (re)connect, so one line = one reconnect), not
// picked for roundness:
//
//   healthy, 2026-08-24  gaps of 1399s, 890s, 434s, 2386s, 2013s and hours.
//                        The TIGHTEST three-reconnect span all day was 1324s.
//   failing, 2026-08-25  three clusters, each around a failed scan:
//                        15:12:29 / 15:15:15 / 15:16:16   → 3 in 227s
//                        18:19:46 / 18:25:42 / 18:29:20   → 3 in 574s
//                        23:36:12 / 23:37:08 / 23:42:11 / 23:43:07 → 4 in 415s
//
// So the populations separate cleanly: worst failing three-span 574s, tightest
// healthy three-span 1324s. A 600s window sits just above the former and at
// less than half the latter, which is why it is 600 and not 300 or 900.
const DEFAULT_BURST_COUNT = 3;
const DEFAULT_BURST_WINDOW_MS = 600_000;

// A deploy or a reader power-cycle reconnects legitimately, and crying wolf at
// either would train everyone to ignore this line. Three things stop that:
//
//  1. This state is per-process and in-memory, so a redeploy starts with an
//     empty history and CANNOT accumulate toward the threshold. In the same
//     48h of logs every `omr.relay.ready` is followed by exactly ONE
//     `omr.relay.status`, 18-23s later — one reconnect, never three.
//  2. The grace below ignores reconnects in the first minute of the process
//     anyway, covering that 18-23s restart reconnect with ~3x margin. It earns
//     its place when the bus is re-created without the process dying, where (1)
//     would not help.
//  3. The threshold is three, not two, so a single power-cycle — even one that
//     lands right after a deploy — is still short of it.
const DEFAULT_STARTUP_GRACE_MS = 60_000;

// A reconnect burst carrying `TASK_WDT` and one carrying `BROWNOUT` are the same
// symptom and opposite investigations: the first says the reader HUNG and its own
// watchdog rebooted it (a firmware/software fault that recovered itself — go read
// /events), the second says the supply sagged (go look at the brick and the
// cable). The relay only speaks esp_reset_reason, so the classification belongs
// here rather than making every future reader of this log line know that
// vocabulary. Unmapped and absent stay distinguishable: 'other' means the board
// reported a reason we do not classify, null means it reported none at all.
const RESET_DIAGNOSIS = {
  TASK_WDT: 'hung-and-recovered',
  INT_WDT: 'hung-and-recovered',
  WDT: 'hung-and-recovered',
  BROWNOUT: 'power',
  POWERON: 'power-or-human',
  PANIC: 'crash',
  SW: 'deliberate',
};

/**
 * @param {object} deps
 * @param {object} deps.eventBus - needs onClientConnection, onClientSubscription,
 *   onClientMessage, onClientDisconnection
 * @param {number} [deps.graceMs] - how long a connection may stay unsubscribed
 *   before it is considered deaf (a healthy board subscribes in milliseconds)
 * @param {string} [deps.source] - the ingest `source` value that identifies an
 *   OMR relay message (matches omrRelay.mjs's RELAY_SOURCE)
 * @param {number} [deps.burstCount] - reconnections inside `burstWindowMs` that
 *   mean the reader is failing rather than having flapped once
 * @param {number} [deps.burstWindowMs] - the rolling window those are counted in
 * @param {number} [deps.startupGraceMs] - how long after process start a
 *   reconnection is treated as this deploy's own, and not counted
 * @param {{now: () => number}} [deps.clock]
 * @param {object} [deps.logger]
 * @returns {{ check: (nowMs?: number) => void }}
 */
export function createOmrReaderLiveness({
  eventBus, graceMs = DEFAULT_GRACE_MS, source = DEFAULT_SOURCE, clock = Date, logger = console,
  burstCount = DEFAULT_BURST_COUNT,
  burstWindowMs = DEFAULT_BURST_WINDOW_MS,
  startupGraceMs = DEFAULT_STARTUP_GRACE_MS,
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

  // ip -> { lastReset, bootCount }, the reader's own post-mortem of its previous
  // life, learned from the same identifying message as the id above. Both fields
  // are OPTIONAL: a board still running firmware from before they existed simply
  // never populates this, and every line below has to read the same either way.
  //
  // This is what turns the burst warning from a symptom into a diagnosis. A
  // burst alone says "the socket keeps dropping" and stops there; the same burst
  // reporting `lastReset: 'BROWNOUT'` names the cause, and one reporting a
  // STEADY `bootCount` says the board never rebooted at all — a network fault
  // wearing a power fault's clothes.
  //
  // Staleness by exactly one connection is intended, not an oversight: a
  // connection is recorded here the instant it arrives, before the new socket's
  // own hello has been received, so the values reported are those of the
  // PRECEDING connection. That is the right ones — a brownout that killed
  // connection N is reported by the hello of connection N+1, which has already
  // landed by the time connection N+2 completes the burst.
  const bootInfoByIp = new Map();

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

  // When this process started, so a restart's own reconnect can be discounted.
  const startedAt = clock.now();

  // ip -> connection timestamps inside the burst window, newest last. Tracked
  // ONLY for an IP already known to be a reader: a first-ever connection cannot
  // be a re-connection, and by the time a board has connected three times it has
  // long since sent the message that names it. That also keeps every other WS
  // client in the house — browsers, kiosks, the MIDI bridge — out of this map
  // entirely, which is both correct and what bounds its size.
  const reconnectsByIp = new Map();
  // ip -> true while a burst has already been reported, so a reader that is
  // flapping for an hour produces one line per burst rather than one per drop.
  // Cleared as soon as the window drains back under the threshold, so a genuine
  // second episode still speaks up.
  const burstReported = new Map();

  eventBus.onClientConnection((clientId, meta) => {
    const ip = meta?.ip ?? null;
    const now = clock.now();
    pending.set(clientId, {
      ip,
      connectedAt: now,
      cleared: false,
      warned: false,
    });
    if (ip && readerIdByIp.has(ip)) recordReconnect(ip, now);
  });

  /**
   * Fold one reconnection into the rolling window and decide whether this
   * reader has crossed from "flapped once" into "is failing".
   */
  function recordReconnect(ip, now) {
    const since = now - burstWindowMs;
    const times = (reconnectsByIp.get(ip) ?? []).filter((t) => t > since);
    times.push(now);
    reconnectsByIp.set(ip, times);

    if (times.length < burstCount) {
      // Recovered: the window drained, so a later burst is a new incident.
      burstReported.delete(ip);
      return;
    }
    // A restart reconnects legitimately; see DEFAULT_STARTUP_GRACE_MS.
    if (now - startedAt < startupGraceMs) return;
    if (burstReported.get(ip)) return;

    burstReported.set(ip, true);
    const boot = bootInfoByIp.get(ip);
    // `warn`, never `debug`: debug is not shipped to the production log store,
    // and a line nobody can query is exactly how this failure mode stayed
    // invisible while a child re-fed the same sheet three times.
    logger.warn?.('omr.reader_liveness.reconnect_burst', {
      id: readerIdByIp.get(ip) ?? null,
      ip,
      reconnects: times.length,
      windowMs: burstWindowMs,
      spanMs: times[times.length - 1] - times[0],
      // Null, not absent, when the reader has not reported them: "this firmware
      // cannot tell you" and "it told you nothing happened" are different
      // answers, and the query that reads this line should be able to see which.
      lastReset: boot?.lastReset ?? null,
      // What that reason MEANS, so the line separates a reader that hung and
      // recovered itself from one whose supply sagged without the query having to.
      resetDiagnosis: boot?.lastReset ? (RESET_DIAGNOSIS[boot.lastReset] ?? 'other') : null,
      bootCount: boot?.bootCount ?? null,
    });
  }

  eventBus.onClientSubscription((clientId) => {
    const entry = pending.get(clientId);
    if (entry) entry.cleared = true;
  });

  eventBus.onClientMessage((clientId, message) => {
    if (message?.source !== source) return;
    const entry = pending.get(clientId);
    const ip = entry?.ip;
    if (ip && typeof message.id === 'string' && message.id) readerIdByIp.set(ip, message.id);
    // The relay's boot post-mortem, carried on its `relay-status` reconnect
    // message. Each field is taken only when the reader actually sent one of the
    // right shape, so a malformed or older payload leaves the previous (or
    // absent) value alone rather than overwriting it with junk.
    if (ip) {
      const lastReset = typeof message.last_reset === 'string' && message.last_reset
        ? message.last_reset : null;
      const bootCount = Number.isFinite(message.boot_count) ? message.boot_count : null;
      if (lastReset !== null || bootCount !== null) {
        const prev = bootInfoByIp.get(ip);
        bootInfoByIp.set(ip, {
          lastReset: lastReset ?? prev?.lastReset ?? null,
          bootCount: bootCount ?? prev?.bootCount ?? null,
        });
      }
    }
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
