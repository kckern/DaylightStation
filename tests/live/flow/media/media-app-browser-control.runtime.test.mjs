import http from 'node:http';
import { test, expect } from '@playwright/test';
import { WebSocketEventBus } from '../../../../backend/src/1_adapters/eventbus/WebSocketEventBus.mjs';
import { registerClientIngress } from '../../../../backend/src/5_composition/modules/clientIngress.mjs';

// Foundation integration, not whole-story acceptance: real browser providers,
// receiver hook/controller, branch WebSocket bus and ingress, and caller
// correlator. Only the socket destination changes; no fabricated ACK/state.
test.use({ viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' });
test.setTimeout(120000);
let server;
let bus;
let socketUrl;

test.beforeAll(async () => {
  server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  bus = new WebSocketEventBus({ logger: { info() {}, warn() {}, error() {}, debug() {} } });
  await bus.start(server);
  registerClientIngress({ eventBus: bus, logger: { info() {}, warn() {}, error() {}, debug() {} } });
  socketUrl = `ws://127.0.0.1:${server.address().port}/ws`;
});

test.afterAll(async () => {
  await bus?.stop();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
});

test('[HOUSE.4a] stable browser identities route a queue command through the actual receiver and return its ack', async ({ browser }) => {
  const callerContext = await browser.newContext();
  const targetContext = await browser.newContext();
  const installSocket = async context => context.addInitScript(({ socketUrl }) => {
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url, protocols) {
        const parsed = new URL(url, location.href);
        const destination = parsed.pathname === '/ws' ? socketUrl : url;
        super(destination, ...(protocols === undefined ? [] : [protocols]));
      }
    };
  }, { socketUrl });
  await Promise.all([installSocket(callerContext), installSocket(targetContext)]);
  const hardwareWrites = [];
  const guardHardware = async route => {
    if (route.request().method() !== 'GET' || /\/load(?:\?|$)/.test(route.request().url())) {
      hardwareWrites.push(route.request().method());
      return route.abort('blockedbyclient');
    }
    return route.continue();
  };
  await Promise.all([callerContext.route('**/api/v1/device/**', guardHardware), targetContext.route('**/api/v1/device/**', guardHardware)]);
  const caller = await callerContext.newPage();
  const target = await targetContext.newPage();
  const received = new Map([[caller, []], [target, []]]);
  for (const browserPage of [caller, target]) {
    browserPage.on('websocket', socket => {
      socket.on('framereceived', frame => {
        try { received.get(browserPage).push(JSON.parse(String(frame.payload))); } catch { /* non-JSON */ }
      });
    });
  }
  try {
  await caller.goto('/media');
  await expect(caller.getByRole('textbox', { name: 'Search media…' })).toBeVisible({ timeout: 30000 });
  await target.goto('/media');
  await expect(target.getByRole('textbox', { name: 'Search media…' })).toBeVisible({ timeout: 30000 });
  const identity = browserPage => received.get(browserPage).find(message => message.type === 'identify_ack' && message.ok === true)?.clientId;
  await expect.poll(() => Boolean(identity(caller) && identity(target))).toBe(true);
  expect(identity(caller)).not.toBe(identity(target));
  const profileId = browserPage => browserPage.evaluate(() => localStorage.getItem('media-app.client-id'));
  expect(await profileId(caller)).toBeTruthy();
  expect(await profileId(target)).not.toBe(await profileId(caller));
  const targetStableId = await profileId(target);
  await target.getByTestId('settings-menu-trigger').click();
  await target.getByTestId('settings-rename-device').click();
  await target.getByRole('textbox', { name: 'Device name' }).fill('Kitchen tablet');
  await target.getByRole('textbox', { name: 'Room' }).fill('Kitchen');
  await target.getByRole('button', { name: 'Save device name' }).click();
  await target.reload();
  await expect(target.getByRole('textbox', { name: 'Search media…' })).toBeVisible({ timeout: 30000 });
  expect(await profileId(target)).toBe(targetStableId);
  expect(await target.evaluate(() => JSON.parse(localStorage.getItem('media-app.browser-identity')))).toMatchObject({
    clientId: targetStableId, deviceId: `browser:${targetStableId}`, name: 'Kitchen tablet', room: 'Kitchen',
  });
  await expect.poll(() => received.get(target).filter(message => message.type === 'identify_ack' && message.ok === true).length).toBeGreaterThan(1);

  await caller.getByTestId('app-nav-fleet').click();
  const targetCard = caller.getByTestId(`fleet-card-browser:${targetStableId}`);
  await expect(targetCard).toContainText('Kitchen tablet', { timeout: 30000 });
  await expect(targetCard).toContainText('Kitchen');

  const commandId = `acceptance-routine-${Date.now()}`;
  const result = await caller.evaluate(async ({ targetId, commandId }) => {
    const callerId = `acceptance-caller-${commandId}`;
    const ws = new WebSocket(`${location.origin.replace(/^http/, 'ws')}/ws`);
    const inbox = [];
    const waitFor = (predicate, timeoutMs = 10_000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('acceptance-control-timeout')), timeoutMs);
      const inspect = message => {
        if (!predicate(message)) return false;
        clearTimeout(timer);
        resolve(message);
        return true;
      };
      const queued = inbox.find(inspect);
      if (queued) return;
      const listener = event => {
        const message = JSON.parse(event.data);
        if (inspect(message)) ws.removeEventListener('message', listener);
        else inbox.push(message);
      };
      ws.addEventListener('message', listener);
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('acceptance-control-connect-failed')), { once: true });
    });
    const nonce = `${commandId}-identify`;
    ws.send(JSON.stringify({ type: 'identify', clientId: callerId, nonce }));
    await waitFor(message => message.type === 'identify_ack' && message.nonce === nonce && message.ok === true);
    const send = async command => {
      ws.send(JSON.stringify({ ...command, topic: `client-control:${targetId}` }));
      return waitFor(message => message.topic === `client-ack:${callerId}` && message.commandId === command.commandId);
    };
    try {
      const origin = { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' };
      const first = await send({ commandId, command: 'queue', params: { op: 'play-now', contentId: 'plex:55854' }, origin });
      const duplicate = await send({ commandId: `${commandId}-duplicate`, command: 'queue', params: { op: 'play-now', contentId: 'plex:55854' }, origin });
      const human = await send({ commandId: `${commandId}-human`, command: 'queue', params: { op: 'add', contentId: 'plex:697368' }, origin: { kind: 'device', id: `browser:${callerId}` } });
      return { first, duplicate, human };
    } finally { ws.close(); }
  }, { targetId: identity(target), commandId });
  expect(result.first).toMatchObject({ commandId, clientId: identity(target), ok: true });
  expect(result.duplicate).toMatchObject({ commandId: `${commandId}-duplicate`, clientId: identity(target), ok: true });
  expect(result.human).toMatchObject({ commandId: `${commandId}-human`, clientId: identity(target), ok: true });
  expect(received.get(target).find(message => message.commandId === commandId)).toMatchObject({
    topic: `client-control:${identity(target)}`, params: { op: 'play-now', contentId: 'plex:55854' },
    origin: { kind: 'routine', name: 'Breakfast', triggerId: 'daily-0700' },
  });
  const native = target.locator('.video-player video');
  await expect(native).toBeVisible({ timeout: 60000 });
  await expect.poll(() => native.evaluate(video => video.readyState >= 2 && !video.paused && video.currentTime > 0), { timeout: 30000 }).toBe(true);
  await target.getByTestId('mini-player-open-nowplaying').click();
  await expect(target.getByTestId('queue-panel').locator('.queue-item-title')).toHaveCount(2);
  await expect(target.getByTestId('queue-panel')).toContainText('Arrival');
  await expect.poll(() => native.evaluate(video => video.currentTime), { timeout: 30000 }).toBeGreaterThan(5);
  const beforeReloadSeconds = await native.evaluate(video => video.currentTime);
  await target.reload();
  await expect(target.getByRole('textbox', { name: 'Search media…' })).toBeVisible({ timeout: 30000 });
  expect(await profileId(target)).toBe(targetStableId);
  // RELY.7a (RQ-RELY-07): a reload restores the session PAUSED and holds the
  // Player until an ordinary Play; it never resumes aloud on its own.
  await expect(target.getByTestId('mini-player-open-nowplaying')).toContainText('Arrival', { timeout: 30000 });
  await expect(target.locator('video')).toHaveCount(0);
  await expect(target.getByTestId('mini-toggle')).toHaveAccessibleName('Play');
  await target.getByTestId('mini-toggle').click();
  const resumedNative = target.locator('.video-player video');
  await expect(resumedNative).toBeVisible({ timeout: 60000 });
  await expect.poll(() => resumedNative.evaluate(video => ({ ready: video.readyState >= 2, paused: video.paused, seconds: video.currentTime })), { timeout: 30000 })
    .toMatchObject({ ready: true, paused: false, seconds: expect.any(Number) });
  expect(await resumedNative.evaluate(video => video.currentTime)).toBeGreaterThanOrEqual(Math.max(0, beforeReloadSeconds - 8));
  const reloadedQueue = target.getByTestId('queue-panel');
  if (!await reloadedQueue.isVisible()) await target.getByTestId('mini-player-open-nowplaying').click();
  await expect(reloadedQueue.locator('.queue-item-title')).toHaveCount(2);
  await expect(caller.getByTestId('mini-player-open-nowplaying')).toHaveCount(0);
  await expect(targetCard).toContainText('Arrival', { timeout: 30000 });
  await expect(targetCard.locator('img')).toBeVisible();
  await expect(targetCard.getByRole('progressbar')).toBeVisible();

  // HOUSE.2a/AC3: configured physical rows and browser rows share the same
  // canonical live-state ordering, rather than configured rows sorting from
  // static config alone.
  const physicalId = 'acceptance-media';
  const physicalCard = caller.getByTestId(`fleet-card-${physicalId}`);
  bus.broadcast(`device-state:${physicalId}`, {
    deviceId: physicalId,
    snapshot: { state: 'paused', currentItem: { contentId: 'plex:physical', title: 'Physical receiver item' } },
    reason: 'change', ts: new Date().toISOString(),
  });
  await expect(caller.getByTestId(`fleet-state-${physicalId}`)).toHaveText('Paused');
  const callerDeviceId = `browser:${await profileId(caller)}`;
  const orderedCardIds = () => caller.locator('[data-testid^="fleet-card-"]').evaluateAll(nodes => nodes.map(node => node.dataset.testid));
  await expect.poll(async () => {
    const ids = await orderedCardIds();
    return ids.indexOf(`fleet-card-browser:${targetStableId}`) < ids.indexOf(`fleet-card-${physicalId}`)
      && ids.indexOf(`fleet-card-${physicalId}`) < ids.indexOf(`fleet-card-${callerDeviceId}`);
  }).toBe(true);
  await expect(caller.getByTestId(`fleet-state-${callerDeviceId}`)).toHaveText('Idle');

  bus.broadcast(`device-state:${physicalId}`, {
    deviceId: physicalId,
    snapshot: { state: 'paused', currentItem: { contentId: 'plex:physical', title: 'Physical receiver item' } },
    reason: 'offline', ts: new Date().toISOString(),
  });
  await expect(caller.getByTestId(`fleet-state-${physicalId}`)).toContainText('Off');
  await expect.poll(async () => {
    const ids = await orderedCardIds();
    return ids.indexOf(`fleet-card-${callerDeviceId}`) < ids.indexOf(`fleet-card-${physicalId}`);
  }).toBe(true);
  await expect(caller.locator('[data-testid^="fleet-card-"]').first()).toHaveAttribute('data-testid', `fleet-card-browser:${targetStableId}`);
  expect(received.get(caller).filter(message => message.topic === `client-control:${identity(target)}`)).toEqual([]);
  expect(hardwareWrites).toEqual([]);
  } finally {
    await Promise.all([callerContext.close(), targetContext.close()]);
  }
});
