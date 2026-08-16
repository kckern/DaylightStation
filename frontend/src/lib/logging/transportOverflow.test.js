import { describe, it, expect, vi, beforeEach } from 'vitest';

// The buffering transport reaches WebSocketService through a dynamic import,
// so the mock has to stand in for that module rather than for a constructor
// argument. `sent` collects whatever the transport hands the socket.
const sent = [];
vi.mock('../../services/WebSocketService.js', () => ({
  wsService: {
    connect: vi.fn(),
    send: (payload) => { sent.push(payload); },
  },
}));

import { createBufferingWebSocketTransport, createWebSocketTransport } from './index.js';

const makeEvent = (n) => ({
  ts: new Date().toISOString(),
  level: 'info',
  event: `evt-${n}`,
  data: { n },
  context: { app: 'piano-kiosk' },
});

beforeEach(() => {
  sent.length = 0;
});

/**
 * The ring discards the OLDEST queued event when it is full — during a storm
 * that is the beginning of the incident, which is the part you most want. It
 * did so with no counter and no marker, so a log with a hole in it was
 * indistinguishable from a log with nothing missing.
 */
describe('buffering WS transport — ring overflow', () => {
  // Batch and interval are set past the test's reach so the queue actually
  // fills instead of draining underneath the assertions.
  const makeTransport = (maxQueue) => createBufferingWebSocketTransport({
    maxQueue, batchSize: 100000, flushInterval: 100000,
  });

  it('counts events dropped to make room', () => {
    const t = makeTransport(10);
    for (let i = 0; i < 15; i += 1) t.send(makeEvent(i));
    expect(t.getStats().dropped).toBe(5);
  });

  it('reports zero drops while the queue has room', () => {
    const t = makeTransport(10);
    for (let i = 0; i < 9; i += 1) t.send(makeEvent(i));
    expect(t.getStats().dropped).toBe(0);
  });

  it('injects the overflow marker into the stream itself, carrying the count', async () => {
    const t = makeTransport(10);
    for (let i = 0; i < 15; i += 1) t.send(makeEvent(i));

    await t.flush();

    const batch = sent.flatMap((p) => p.events || []);
    const marker = batch.map((e) => e.event).find((e) => e?.event === 'logging.transport.overflow');
    expect(marker, 'no overflow marker reached the socket').toBeTruthy();
    expect(marker.level).toBe('warn');
    expect(marker.data.droppedCount).toBe(5);
    expect(marker.data.maxQueue).toBe(10);
  });

  it('coalesces one marker per burst rather than one per dropped event', async () => {
    const t = makeTransport(10);
    for (let i = 0; i < 25; i += 1) t.send(makeEvent(i));

    await t.flush();

    const markers = sent.flatMap((p) => p.events || [])
      .map((e) => e.event)
      .filter((e) => e?.event === 'logging.transport.overflow');
    expect(markers).toHaveLength(1);
    expect(markers[0].data.droppedCount).toBe(15);
  });

  it('marks a later burst again once the first marker has been flushed away', async () => {
    const t = makeTransport(10);
    for (let i = 0; i < 15; i += 1) t.send(makeEvent(i));
    await t.flush();
    sent.length = 0;

    for (let i = 0; i < 15; i += 1) t.send(makeEvent(i));
    await t.flush();

    const markers = sent.flatMap((p) => p.events || [])
      .map((e) => e.event)
      .filter((e) => e?.event === 'logging.transport.overflow');
    expect(markers).toHaveLength(1);
    // The counter is cumulative for the transport's life — 5 dropped in the
    // first burst, 5 more in the second.
    expect(markers[0].data.droppedCount).toBe(10);
  });
});

// The unbuffered sibling has the identical ring and the identical silence.
describe('unbuffered WS transport — ring overflow', () => {
  it('counts events dropped to make room', () => {
    const t = createWebSocketTransport({ maxQueue: 5 });
    for (let i = 0; i < 8; i += 1) t.send(makeEvent(i));
    expect(t.getStats().dropped).toBeGreaterThan(0);
  });

  // Its flush sends one payload at a time, so the marker riding along with a
  // batch must not be dropped on the floor by a single-item destructure.
  it('delivers the overflow marker to the socket', async () => {
    const t = createWebSocketTransport({ maxQueue: 5 });
    for (let i = 0; i < 8; i += 1) t.send(makeEvent(i));
    await t.flush();

    const marker = sent.map((p) => p.event).find((e) => e?.event === 'logging.transport.overflow');
    expect(marker, 'no overflow marker reached the socket').toBeTruthy();
    expect(marker.data.transport).toBe('ws');
    expect(marker.data.droppedCount).toBe(3);
  });
});
