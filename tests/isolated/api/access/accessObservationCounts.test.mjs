import { EventEmitter, once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createAccessObservationCounts } from '#system/logging/accessObservationCounts.mjs';
import { createServerRequestHandler } from '#api/serverRequestHandler.mjs';
import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';

describe('access observation windows', () => {
  it('counts an edge probe, an annotated fetch, and an upgrade separately', async () => {
    let now = 0;
    const logger = { info: vi.fn() };
    const counts = createAccessObservationCounts({ logger, clock: () => now, writerId: 'test', intervalMs: 60_000 });
    const observeHttp = createServerRequestHandler({
      observe: counts.record,
      app: (req, res) => {
        req.accessObservation = { resolution: 'exact', householdId: 'a' };
        res.end();
      },
    });
    const response = () => Object.assign(new EventEmitter(), {
      setHeader() {},
      end() { this.emit('finish'); this.emit('close'); },
    });
    observeHttp({ headers: { host: 'Mapped.Example' }, url: '/healthz' }, response());
    observeHttp({ headers: { host: 'Mapped.Example' }, url: '/api/v1/ignored' }, response());

    const server = createServer();
    const bus = new WebSocketEventBus({ logger: {}, observeUpgrade: counts.record });
    await bus.start(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`, { headers: { Host: 'Mapped.Example' } });
    try {
      await once(ws, 'open');
      now = 60_000;
      counts.flush();
      expect(logger.info).toHaveBeenCalledOnce();
      expect(logger.info).toHaveBeenCalledWith('access.inventory.window', expect.objectContaining({
        writerId: 'test', start: 0, end: 60_000, sequence: 1, overflow: false,
        observations: expect.arrayContaining([
          { ingress: 'http', host: 'mapped.example', resolution: 'unresolved-by-router', householdId: null, requests: 1 },
          { ingress: 'http', host: 'mapped.example', resolution: 'exact', householdId: 'a', requests: 1 },
          { ingress: 'websocket', host: 'mapped.example', resolution: 'unresolved-by-router', householdId: null, requests: 1 },
        ]),
      }));
    } finally {
      ws.terminate();
      await bus.stop();
      server.close();
    }
  });

  it('emits idle windows and records when cardinality overflows', () => {
    let now = 0;
    const logger = { info: vi.fn() };
    const counts = createAccessObservationCounts({ logger, writerId: 'test', clock: () => now, intervalMs: 60_000, maxHosts: 1 });
    counts.record({ host: 'one.example', ingress: 'http' });
    counts.record({ host: 'two.example', ingress: 'http' });
    now = 120_000;
    counts.flush();
    expect(logger.info.mock.calls.map(([, data]) => [data.sequence, data.overflow, data.observations.length])).toEqual([
      [1, true, 1], [2, false, 0],
    ]);
  });
});
