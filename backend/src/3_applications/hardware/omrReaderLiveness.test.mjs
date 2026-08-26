// backend/src/3_applications/hardware/omrReaderLiveness.test.mjs
//
// Incident (2026-08-25): a card reader flapped, and on some reconnects the
// backend held a live socket for it that never subscribed to its topic. In
// that state the reader believes it is online, but a scan produces no
// backend event at all — nobody learns anything until a child is standing
// at the printer. This liveness check makes that state visible: a relay
// client connected-but-never-subscribed past a short grace period logs a
// named warning, once per deaf connection.
import { describe, it, expect } from 'vitest';
import { createOmrReaderLiveness } from './omrReaderLiveness.mjs';

const READER_ID = 'study-omr';
const READER_IP = '10.0.0.19';

/**
 * A minimal fake IEventBus exposing exactly the four handler-registration
 * hooks the liveness service needs, plus test-only drivers to simulate the
 * lifecycle events a real WebSocketEventBus would fire.
 */
function makeBus() {
  let onConnect = null;
  let onSubscribe = null;
  let onMessage = null;
  let onDisconnect = null;
  return {
    onClientConnection(fn) { onConnect = fn; },
    onClientSubscription(fn) { onSubscribe = fn; },
    onClientMessage(fn) { onMessage = fn; },
    onClientDisconnection(fn) { onDisconnect = fn; },
    // test-only drivers
    connect(clientId, meta = {}) { onConnect?.(clientId, { ip: READER_IP, ...meta }); },
    subscribe(clientId, topics = ['omr']) { onSubscribe?.(clientId, topics); },
    message(clientId, message) { onMessage?.(clientId, message); },
    disconnect(clientId) { onDisconnect?.(clientId); },
  };
}

function harness(opts = {}) {
  const logged = [];
  const logger = {
    warn: (event, data) => logged.push({ event, data }),
    info: () => {},
    debug: () => {},
    error: () => {},
  };
  const bus = makeBus();
  let now = 0;
  const clock = { now: () => now };
  const liveness = createOmrReaderLiveness({ eventBus: bus, logger, clock, ...opts });
  return {
    logged, bus, liveness,
    advance(ms) { now += ms; },
    warnings: () => logged.filter((l) => l.event === 'omr.reader_liveness.deaf'),
  };
}

// A prior, healthy connection from the same IP is how the service learns
// the reader's id at all — a truly first-ever, never-before-seen connection
// has nothing to name and (by design) is not warned about.
function seedKnownReader({ bus, advance }) {
  bus.connect('seed-client');
  bus.message('seed-client', { source: 'omr-relay', type: 'relay-status', id: READER_ID });
  bus.subscribe('seed-client', ['omr']);
  bus.disconnect('seed-client');
  advance(1000);
}

describe('createOmrReaderLiveness', () => {
  it('produces no warning for a client that connects and subscribes promptly', () => {
    const h = harness({ graceMs: 5000 });
    seedKnownReader(h);

    h.bus.connect('client-1');
    h.advance(200);
    h.bus.subscribe('client-1', ['omr']);
    h.advance(10_000);
    h.liveness.check();

    expect(h.warnings()).toHaveLength(0);
  });

  it('warns once, naming the reader and client id, after a client connects and never subscribes', () => {
    const h = harness({ graceMs: 5000 });
    seedKnownReader(h);

    h.bus.connect('client-2');
    h.advance(5001);
    h.liveness.check();

    const warnings = h.warnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0].data).toMatchObject({ id: READER_ID, clientId: 'client-2', ip: READER_IP });
  });

  it('does not warn before the grace period has elapsed', () => {
    const h = harness({ graceMs: 5000 });
    seedKnownReader(h);

    h.bus.connect('client-3');
    h.advance(1000);
    h.liveness.check();

    expect(h.warnings()).toHaveLength(0);
  });

  it('does not repeat the warning for the same deaf client on later checks', () => {
    const h = harness({ graceMs: 5000 });
    seedKnownReader(h);

    h.bus.connect('client-4');
    h.advance(5001);
    h.liveness.check();
    h.advance(5000);
    h.liveness.check();
    h.advance(5000);
    h.liveness.check();

    expect(h.warnings()).toHaveLength(1);
  });

  it('does not warn for a connection from an IP that has never been identified as a reader', () => {
    const h = harness({ graceMs: 5000 });
    // No seedKnownReader() — this IP/reader has never been seen before.
    const bus = h.bus;
    bus.connect('client-unknown', { ip: '10.0.0.99' });
    h.advance(10_000);
    h.liveness.check();

    expect(h.warnings()).toHaveLength(0);
  });

  it('clears pending state on disconnect so a clean short-lived reconnect never warns', () => {
    const h = harness({ graceMs: 5000 });
    seedKnownReader(h);

    h.bus.connect('client-5');
    h.advance(500);
    h.bus.disconnect('client-5');
    h.advance(10_000);
    h.liveness.check();

    expect(h.warnings()).toHaveLength(0);
  });
});

// The second signature: the reader keeps dropping and coming back. Every
// individual connection subscribes promptly and looks perfectly healthy, so
// the deaf check above stays silent throughout — the fault is only in the
// rate. Thresholds are the shipped defaults (3 reconnects / 600s), which were
// read off the 2026-08-25 incident; see the module header.
describe('createOmrReaderLiveness — reconnect bursts', () => {
  const bursts = (h) => h.logged.filter((l) => l.event === 'omr.reader_liveness.reconnect_burst');

  /** Get clear of the startup grace, so these are not "this deploy's own". */
  function settle(h) {
    seedKnownReader(h);
    h.advance(120_000);
  }

  /** One drop-and-return, each connection healthy in isolation. */
  function flap(h, clientId, gapMs) {
    h.bus.connect(clientId);
    h.bus.subscribe(clientId, ['omr']);
    h.bus.disconnect(clientId);
    h.advance(gapMs);
  }

  it('warns once when a reader reconnects three times inside the window', () => {
    const h = harness();
    settle(h);

    flap(h, 'c1', 60_000);
    flap(h, 'c2', 60_000);
    flap(h, 'c3', 0);

    const warned = bursts(h);
    expect(warned).toHaveLength(1);
    expect(warned[0].data).toMatchObject({ id: READER_ID, ip: READER_IP, reconnects: 3 });
    expect(warned[0].data.spanMs).toBe(120_000);
    // The rate is the whole fault: nothing here looked deaf.
    expect(h.warnings()).toHaveLength(0);
  });

  it('stays quiet for two reconnects — one flap is not a failing reader', () => {
    const h = harness();
    settle(h);

    flap(h, 'c1', 60_000);
    flap(h, 'c2', 0);

    expect(bursts(h)).toHaveLength(0);
  });

  it('stays quiet when the same three reconnects are spread beyond the window', () => {
    const h = harness();
    settle(h);

    // 2026-08-24's healthy spacing: the tightest three-reconnect span all day
    // was 1324s, comfortably wider than the 600s window.
    flap(h, 'c1', 700_000);
    flap(h, 'c2', 700_000);
    flap(h, 'c3', 0);

    expect(bursts(h)).toHaveLength(0);
  });

  it('does not cry wolf on a restart: reconnects inside the startup grace are this deploy\'s own', () => {
    const h = harness();
    seedKnownReader(h);
    // No settle() — we are still inside startupGraceMs, as a redeploy would be.
    flap(h, 'c1', 5_000);
    flap(h, 'c2', 5_000);
    flap(h, 'c3', 0);

    expect(bursts(h)).toHaveLength(0);
  });

  it('reports one line per burst, not one per drop, while a reader keeps flapping', () => {
    const h = harness();
    settle(h);

    flap(h, 'c1', 30_000);
    flap(h, 'c2', 30_000);
    flap(h, 'c3', 30_000);
    flap(h, 'c4', 30_000);
    flap(h, 'c5', 0);

    expect(bursts(h)).toHaveLength(1);
  });

  it('re-arms once the window drains, so a genuine second episode still speaks up', () => {
    const h = harness();
    settle(h);

    flap(h, 'c1', 60_000);
    flap(h, 'c2', 60_000);
    flap(h, 'c3', 0);
    expect(bursts(h)).toHaveLength(1);

    // Quiet for longer than the window, then a fresh cluster.
    h.advance(700_000);
    flap(h, 'd1', 60_000);
    flap(h, 'd2', 60_000);
    flap(h, 'd3', 0);

    expect(bursts(h)).toHaveLength(2);
  });

  it('does not track an IP that has never been identified as a reader', () => {
    const h = harness();
    h.advance(120_000);
    // No seedKnownReader(): nothing here can be named, so nothing is claimed.
    for (const id of ['x1', 'x2', 'x3', 'x4']) h.bus.connect(id, { ip: '10.0.0.99' });

    expect(bursts(h)).toHaveLength(0);
  });
});
