/**
 * WebSocketEventBus — client-control:<clientId> relay tests.
 *
 * Covers Task 4.1: identity-scoped delivery for the client-control topic.
 * After a client registers via `{ type: 'identify', clientId }`, broadcasts
 * on `client-control:<id>` are delivered only to that connection. Envelope
 * payloads are validated against the command contract before delivery.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebSocketEventBus } from '#system/eventbus/WebSocketEventBus.mjs';
import { CLIENT_CONTROL_TOPIC } from '#shared-contracts/media/topics.mjs';

const OPEN = 1;

function makeClient({ clientId, subscriptions = [] } = {}) {
  const ws = {
    readyState: OPEN,
    OPEN,
    send: vi.fn(),
  };
  const meta = {
    subscriptions: new Set(subscriptions),
  };
  if (clientId) meta.clientId = clientId;
  return { ws, meta };
}

function makePool(clientsById) {
  return new Map(Object.entries(clientsById));
}

function makeBus() {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const bus = new WebSocketEventBus({ logger });
  bus._testSetServerAttached();
  return { bus, logger };
}

function validCommandEnvelope(overrides = {}) {
  return {
    type: 'command',
    command: 'transport',
    params: { action: 'play' },
    commandId: 'cmd-1',
    ts: '2026-04-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('WebSocketEventBus — client-control:<id> relay', () => {
  let bus, logger, c1, c2, wildcard;

  beforeEach(() => {
    const made = makeBus();
    bus = made.bus;
    logger = made.logger;

    c1 = makeClient({ clientId: 'c1' });
    c2 = makeClient({ clientId: 'c2' });
    wildcard = makeClient({ subscriptions: ['*'] });

    bus._testSetClientPool(makePool({
      conn1: c1,
      conn2: c2,
      wild: wildcard,
    }));
  });

  it('delivers a valid envelope on client-control:c1 only to the c1-identified connection', () => {
    const envelope = validCommandEnvelope();
    const count = bus.broadcast(CLIENT_CONTROL_TOPIC('c1'), envelope);

    expect(c1.ws.send).toHaveBeenCalledTimes(1);
    expect(c2.ws.send).not.toHaveBeenCalled();
    // Wildcard subscribers DO NOT receive client-control — it's identity-scoped.
    expect(wildcard.ws.send).not.toHaveBeenCalled();
    expect(count).toBe(1);
  });

  it('drops broadcast when no connection carries the target clientId (logs debug)', () => {
    const envelope = validCommandEnvelope();
    const count = bus.broadcast(CLIENT_CONTROL_TOPIC('nobody'), envelope);

    expect(c1.ws.send).not.toHaveBeenCalled();
    expect(c2.ws.send).not.toHaveBeenCalled();
    expect(wildcard.ws.send).not.toHaveBeenCalled();
    expect(count).toBe(0);
    expect(logger.debug).toHaveBeenCalledWith(
      'client-control.no-client',
      expect.objectContaining({
        topic: CLIENT_CONTROL_TOPIC('nobody'),
        clientId: 'nobody',
      }),
    );
  });

  it('drops + warns when envelope is not a valid command envelope', () => {
    bus.broadcast(CLIENT_CONTROL_TOPIC('c1'), { not: 'a command' });

    expect(c1.ws.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'client-control.envelope-invalid',
      expect.objectContaining({
        topic: CLIENT_CONTROL_TOPIC('c1'),
        clientId: 'c1',
      }),
    );
  });

  it('does NOT leak client-control broadcasts to wildcard subscribers', () => {
    // Confirmed via delivery count — restated here with a distinct assertion
    // on wildcard to guard against regressions in future routing code.
    const envelope = validCommandEnvelope();
    bus.broadcast(CLIENT_CONTROL_TOPIC('c1'), envelope);

    expect(wildcard.ws.send).not.toHaveBeenCalled();
  });

  it('publish from an unrelated source still reaches the identified client (no publisher authority check at bus layer)', () => {
    // The bus does not verify that the publisher is authorized to send to a
    // given client. That's a higher-layer concern (router / auth). Documented
    // as expected behavior.
    const envelope = validCommandEnvelope({ commandId: 'spoofed' });
    bus.broadcast(CLIENT_CONTROL_TOPIC('c1'), envelope);

    expect(c1.ws.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(c1.ws.send.mock.calls[0][0]);
    expect(sent.commandId).toBe('spoofed');
  });

  it('handles `{ type: "identify", clientId }` message by recording identity on the client', () => {
    // Start with a fresh bus/client pool so we exercise the identify path.
    const { bus: bus2, logger: logger2 } = makeBus();
    const plain = makeClient(); // no clientId yet
    bus2._testSetClientPool(makePool({ connX: plain }));

    // Simulate the incoming identify message via the test seam.
    bus2._testHandleIncomingMessage('connX', { type: 'identify', clientId: 'phone-1' });

    expect(plain.meta.clientId).toBe('phone-1');
    expect(logger2.info).toHaveBeenCalledWith(
      'eventbus.client_identified',
      expect.objectContaining({ connectionId: 'connX', clientId: 'phone-1' }),
    );
    // identify_ack was queued back.
    expect(plain.ws.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'identify_ack', clientId: 'phone-1' }),
    );

    // Now a broadcast on client-control:phone-1 lands on this connection.
    bus2.broadcast(CLIENT_CONTROL_TOPIC('phone-1'), validCommandEnvelope());
    expect(plain.ws.send).toHaveBeenCalledTimes(2);
  });

  it('ignores identify messages with missing/invalid clientId', () => {
    const { bus: bus2, logger: logger2 } = makeBus();
    const plain = makeClient();
    bus2._testSetClientPool(makePool({ connY: plain }));

    bus2._testHandleIncomingMessage('connY', { type: 'identify', clientId: '' });
    expect(plain.meta.clientId).toBeUndefined();
    expect(logger2.warn).toHaveBeenCalledWith(
      'eventbus.identify_invalid',
      expect.objectContaining({ connectionId: 'connY' }),
    );
  });
});
