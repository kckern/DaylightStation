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
