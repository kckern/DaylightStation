import http from 'node:http';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketEventBus } from '#adapters/eventbus/WebSocketEventBus.mjs';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
let teardown = [];
afterEach(async () => { for (const fn of teardown.reverse()) await fn(); teardown = []; });

async function startBus(options = {}) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const bus = new WebSocketEventBus({ logger: quiet, ...options });
  await bus.start(server);
  teardown.push(async () => { await bus.stop(); await new Promise((resolve) => server.close(resolve)); });
  return { bus, port: server.address().port };
}

/** Resolves 'open' or the HTTP status the upgrade was refused with. */
function connect(port, headers = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    ws.on('open', () => { ws.close(); resolve('open'); });
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.on('error', () => {});
  });
}

describe('WebSocketEventBus refuses browser pages from other sites', () => {
  it('accepts no Origin, a firmware file:// Origin, and the app\'s own page', async () => {
    const { port } = await startBus();
    expect(await connect(port)).toBe('open');
    expect(await connect(port, { Origin: 'file://' })).toBe('open');
    expect(await connect(port, { Origin: `http://127.0.0.1:${port}` })).toBe('open');
  });

  it('refuses another site, and the opaque origin null, with 403 and a sampled log', async () => {
    const events = [];
    const logger = { ...quiet, sampled: (event, data, opts) => events.push({ event, data, opts }) };
    const { port } = await startBus({ logger });
    expect(await connect(port, { Origin: 'https://evil.example' })).toBe(403);
    expect(await connect(port, { Origin: 'null' })).toBe(403);
    expect(events.map((e) => [e.event, e.data.reason, e.data.origin])).toEqual([
      ['security.ws-origin-refused', 'origin-mismatch', 'https://evil.example'],
      ['security.ws-origin-refused', 'origin-null', 'null'],
    ]);
    expect(events[0].opts).toMatchObject({ maxPerMinute: 20, aggregate: true, level: 'warn' });
  });

  it('accepts an origin on the configured allow-list', async () => {
    const { port } = await startBus({ allowedOrigins: ['https://partner.example'] });
    expect(await connect(port, { Origin: 'https://partner.example' })).toBe('open');
    expect(await connect(port, { Origin: 'https://other.example' })).toBe(403);
  });

  it('keeps the check after a restart', async () => {
    const { bus, port } = await startBus();
    await bus.restart();
    expect(await connect(port, { Origin: 'https://evil.example' })).toBe(403);
    expect(await connect(port)).toBe('open');
  });
});
