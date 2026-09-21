import http from 'node:http';
import { test, expect } from '@playwright/test';
import { WebSocketEventBus } from '../../../../backend/src/1_adapters/eventbus/WebSocketEventBus.mjs';
import { EventBusClientIngressAdapter } from '../../../../backend/src/1_adapters/eventbus/EventBusClientIngressAdapter.mjs';
import { ClientIngressService } from '../../../../backend/src/3_applications/eventbus/ClientIngressService.mjs';

// Foundation integration, not whole-story acceptance: real browser providers,
// receiver hook/controller, branch WebSocket bus and ingress, and caller
// correlator. Only the socket destination changes; no fabricated ACK/state.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });
test.setTimeout(90000);
let server;
let bus;
let socketUrl;

test.beforeAll(async () => {
  server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  bus = new WebSocketEventBus({ logger: { info() {}, warn() {}, error() {}, debug() {} } });
  await bus.start(server);
  const publications = new EventBusClientIngressAdapter({ eventBus: bus });
  publications.attach(new ClientIngressService({ publications }));
  socketUrl = `ws://127.0.0.1:${server.address().port}/ws`;
});

test.afterAll(async () => {
  await bus?.stop();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});

test('[F2 foundation] same-profile tabs route a queue command through the actual receiver and return its ack', async ({ context, page: caller }) => {
  await context.addInitScript(({ socketUrl }) => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        const parsed = new URL(url, location.href);
        const destination = parsed.pathname === '/ws' ? socketUrl : url;
        super(destination, ...(protocols === undefined ? [] : [protocols]));
      }
    };
  }, { socketUrl });
  const hardwareWrites = [];
  await context.route('**/api/v1/device/**', async route => {
    if (route.request().method() !== 'GET' || /\/load(?:\?|$)/.test(route.request().url())) {
      hardwareWrites.push(route.request().method());
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const target = await context.newPage();
  const received = new Map([[caller, []], [target, []]]);
  for (const browserPage of [caller, target]) {
    browserPage.on('websocket', socket => {
      socket.on('framereceived', frame => {
        try { received.get(browserPage).push(JSON.parse(String(frame.payload))); } catch { /* non-JSON */ }
      });
    });
  }
  // Sequential navigation ensures the shared persistent profile identity is
  // already created before the second provider mounts.
  await caller.goto('/media');
  await expect(caller.getByRole('textbox', { name: 'Search media…' })).toBeVisible({ timeout: 30000 });
  await target.goto('/media');
  await expect(target.getByRole('textbox', { name: 'Search media…' })).toBeVisible({ timeout: 30000 });
  const identity = browserPage => received.get(browserPage).find(message => message.type === 'identify_ack' && message.ok === true)?.clientId;
  await expect.poll(() => Boolean(identity(caller) && identity(target))).toBe(true);
  expect(identity(caller)).not.toBe(identity(target));
  const profileId = browserPage => browserPage.evaluate(() => localStorage.getItem('media-app.client-id'));
  expect(await profileId(caller)).toBeTruthy();
  expect(await profileId(target)).toBe(await profileId(caller));

  const commandId = `acceptance-queue-${Date.now()}`;
  const ack = await caller.evaluate(async ({ callerId, targetId, commandId }) => {
    const { wsService } = await import('/src/services/WebSocketService.js');
    const { createClientControlCorrelator } = await import('/src/modules/Media/externalControl/clientControlCorrelator.js');
    const correlator = createClientControlCorrelator({ controlClientId: callerId, service: wsService });
    try {
      return await correlator.send({ targetControlClientId: targetId,
        command: { commandId, command: 'queue', params: { op: 'add', contentId: 'plex:55854' } } });
    } finally { correlator.dispose(); }
  }, { callerId: identity(caller), targetId: identity(target), commandId });
  expect(ack).toMatchObject({ commandId, clientId: identity(target), ok: true });
  expect(received.get(target).find(message => message.commandId === commandId)).toMatchObject({
    topic: `client-control:${identity(target)}`, params: { op: 'add', contentId: 'plex:55854' },
  });
  await target.getByTestId('mini-player-open-nowplaying').click();
  await expect(target.getByTestId('queue-panel').locator('.queue-item-title')).toHaveCount(1);
  await expect(caller.getByTestId('mini-player-open-nowplaying')).toHaveCount(0);
  await expect(target.locator('video')).toHaveCount(0);
  expect(received.get(caller).filter(message => message.topic === `client-control:${identity(target)}`)).toEqual([]);
  expect(hardwareWrites).toEqual([]);
  await target.close();
});
