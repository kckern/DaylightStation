/**
 * device-start:<id> (RQ-HOUSE-04) — routed like other per-device topics and
 * replayed to a new subscriber (exact topic or wildcard) from the start-status
 * service, so a house view opened after a failure still shows it.
 */
import { describe, it, expect, vi } from 'vitest';
import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';
import { DEVICE_START_TOPIC } from '#shared-contracts/media/topics.mjs';

const OPEN = 1;
const makeClient = (subscriptions = []) => ({
  ws: { readyState: OPEN, OPEN, send: vi.fn() },
  meta: { subscriptions: new Set(subscriptions) },
});
const sentTopics = (client) => client.ws.send.mock.calls.map(([raw]) => JSON.parse(raw).topic);

function makeBus() {
  const bus = new WebSocketEventBus({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  bus._testSetServerAttached();
  return bus;
}

const status = (deviceId) => ({ topic: 'device-start', deviceId, phase: 'failed', error: 'boom', updatedAt: 'x' });

describe('WebSocketEventBus — device-start topic', () => {
  it('delivers device-start:<id> to that topic and to wildcard subscribers only', () => {
    const bus = makeBus();
    const exact = makeClient([DEVICE_START_TOPIC('tv')]);
    const wildcard = makeClient(['*']);
    const other = makeClient([DEVICE_START_TOPIC('other')]);
    bus._testSetClientPool(new Map(Object.entries({ exact, wildcard, other })));
    bus.broadcast(DEVICE_START_TOPIC('tv'), status('tv'));
    expect(sentTopics(exact)).toEqual(['device-start:tv']);
    expect(sentTopics(wildcard)).toEqual(['device-start:tv']);
    expect(other.ws.send).not.toHaveBeenCalled();
  });

  it('replays the last start status on exact and wildcard subscription', () => {
    const bus = makeBus();
    const statuses = { tv: status('tv'), kitchen: status('kitchen') };
    bus.setStartStatusService({ get: (id) => statuses[id] ?? null, knownDeviceIds: () => Object.keys(statuses) });
    const exact = makeClient();
    const wildcard = makeClient();
    bus._testSetClientPool(new Map(Object.entries({ exact, wildcard })));

    bus.subscribeClient('exact', [DEVICE_START_TOPIC('tv')]);
    expect(sentTopics(exact)).toEqual(['device-start:tv']);
    expect(JSON.parse(exact.ws.send.mock.calls[0][0])).toMatchObject({ deviceId: 'tv', phase: 'failed' });

    bus.subscribeClient('wildcard', ['*']);
    expect(sentTopics(wildcard).sort()).toEqual(['device-start:kitchen', 'device-start:tv']);
  });

  it('replays nothing when no start was ever seen for the device', () => {
    const bus = makeBus();
    bus.setStartStatusService({ get: () => null, knownDeviceIds: () => [] });
    const client = makeClient();
    bus._testSetClientPool(new Map([['c', client]]));
    bus.subscribeClient('c', [DEVICE_START_TOPIC('tv')]);
    expect(client.ws.send).not.toHaveBeenCalled();
  });
});
