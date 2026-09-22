import express from 'express';
import { randomUUID } from 'node:crypto';
import { WebSocketEventBus } from '../../backend/src/1_adapters/eventbus/WebSocketEventBus.mjs';
import { WebSocketContentAdapter } from '../../backend/src/1_adapters/devices/WebSocketContentAdapter.mjs';
import { EventBusClientIngressAdapter } from '../../backend/src/1_adapters/eventbus/EventBusClientIngressAdapter.mjs';
import { EventBusPlaybackStateRelay } from '../../backend/src/1_adapters/eventbus/EventBusMediaClientIngress.mjs';
import { EventBusDeviceTransportGateway } from '../../backend/src/1_adapters/devices/EventBusDeviceTransportGateway.mjs';
import { ClientIngressService } from '../../backend/src/3_applications/eventbus/ClientIngressService.mjs';
import { WakeAndLoadService } from '../../backend/src/3_applications/devices/services/WakeAndLoadService.mjs';
import { DeviceContentDispatchService } from '../../backend/src/3_applications/devices/services/DeviceContentDispatchService.mjs';
import { DeviceLivenessService } from '../../backend/src/3_applications/devices/services/DeviceLivenessService.mjs';
import { CommandHandlerLivenessService } from '../../backend/src/3_applications/devices/services/CommandHandlerLivenessService.mjs';
import { DispatchIdempotencyService } from '../../backend/src/3_applications/devices/services/DispatchIdempotencyService.mjs';
import { SessionControlService } from '../../backend/src/3_applications/devices/services/SessionControlService.mjs';
import { DeviceSessionApiService } from '../../backend/src/3_applications/devices/services/DeviceSessionApiService.mjs';
import { createDeviceRouter } from '../../backend/src/4_api/v1/routers/device.mjs';

export const ORDINARY_DEVICE_ID = 'acceptance-media';
const VIRTUAL_TRANSPORT_ACTIONS = new Set(['pause', 'play', 'seekAbs', 'seekRel', 'skipNext', 'skipPrev', 'stop']);
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const scheduler = {
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  after: (ms, fn) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); },
  withDeadline: (promise) => promise,
};

// This is deliberately not a browser-driving substitute for a real device:
// it can only prepare an already-mounted receiver. A missing WS receiver
// fails closed rather than loading a physical device or inventing success.
function virtualReceiver(eventBus, logger) {
  const content = new WebSocketContentAdapter({
    deviceId: ORDINARY_DEVICE_ID,
    topic: `homeline:${ORDINARY_DEVICE_ID}`,
  }, { wsBus: eventBus, logger });
  return {
    screenPath: '/screen/living-room',
    defaultVolume: null,
    hasCapability: () => false,
    powerOn: async () => ({ ok: true, skipped: 'no_device_control' }),
    prepareForContent: async (options) => ({ ...(await content.prepareForContent(options)), coldRestart: false, cameraSkipped: true }),
    // WakeAndLoad's ordinary warm path broadcasts directly after positive
    // subscriber+liveness proof. This real adapter is the service's cold/fallback
    // path; it never navigates hardware or manufactures an acknowledgement.
    loadContent: async (_path, query) => content.load(_path, query),
  };
}

export function createMediaOrdinaryDeviceFixture({ upstream, logger = quiet } = {}) {
  if (!upstream) throw new Error('createMediaOrdinaryDeviceFixture requires upstream');
  const eventBus = new WebSocketEventBus({ logger });
  const publications = new EventBusClientIngressAdapter({ eventBus });
  publications.attach(new ClientIngressService({ publications, logger }));
  new EventBusPlaybackStateRelay({ eventBus, logger }).attach();
  const presenceGateway = new EventBusDeviceTransportGateway({ eventBus });
  const deviceLiveness = new DeviceLivenessService({
    presenceGateway, logger, scheduler, offlineTimeoutMs: 60_000,
  });
  deviceLiveness.start();
  eventBus.setLivenessService(deviceLiveness);
  const commandLiveness = new CommandHandlerLivenessService({ presenceGateway, logger });
  commandLiveness.start();
  const device = virtualReceiver(eventBus, logger);
  const deviceService = { get: (id) => id === ORDINARY_DEVICE_ID ? device : null };
  const wakeAndLoad = new WakeAndLoadService({
    deviceService,
    readinessPolicy: { isReady: async () => ({ ready: true }) },
    broadcast: (message) => eventBus.broadcast(message.topic, message),
    eventBus,
    commandHandlerLivenessService: commandLiveness,
    deviceLivenessService: deviceLiveness,
    clock: { now: () => Date.now() },
    createDispatchId: randomUUID,
    scheduler,
    logger,
  });
  const configuration = {
    device: (id) => id === ORDINARY_DEVICE_ID ? { id, content_control: { type: 'websocket' }, fleet: true } : null,
  };
  const dispatchService = new DeviceContentDispatchService({
    wakeAndLoad,
    configuration,
    idempotency: new DispatchIdempotencyService({ clock: { now: () => Date.now() }, logger }),
    logger,
  });
  const fleetService = {
    configuration: () => ({ devices: {
      [ORDINARY_DEVICE_ID]: { name: 'Acceptance receiver', location: 'Virtual browser', icon: 'tv', fleet: true,
        content_control: { type: 'websocket' }, screen_path: '/screen/living-room' },
    } }),
    list: () => [{ id: ORDINARY_DEVICE_ID, name: 'Acceptance receiver', fleet: true }],
  };
  const unavailable = { configured: () => false };
  const sessionControl = new SessionControlService({
    transportGateway: presenceGateway,
    livenessService: deviceLiveness,
    logger,
  });
  const sessionService = new DeviceSessionApiService({ sessionControl, logger });
  const router = createDeviceRouter({
    fleetService, dispatchService, presenceService: unavailable, sessionService,
    screenService: unavailable, recoveryService: unavailable,
  });
  const app = express();
  app.use(express.json());
  app.get(`/${ORDINARY_DEVICE_ID}/receiver-ready`, (_req, res) => {
    const subscribers = eventBus.getTopicSubscriberCount(`homeline:${ORDINARY_DEVICE_ID}`);
    return res.json({ ready: subscribers > 0 && commandLiveness.isFresh(ORDINARY_DEVICE_ID), subscribers });
  });
  app.get(`/${ORDINARY_DEVICE_ID}/receiver-state`, (_req, res) => {
    const state = deviceLiveness.getLastSnapshot(ORDINARY_DEVICE_ID);
    return state ? res.json(state) : res.status(404).json({ error: 'receiver has not published state' });
  });
  app.use((req, res, next) => {
    const path = req.path;
    if (req.method === 'GET' && path === '/config') return next();
    if (req.method === 'GET' && path === `/${ORDINARY_DEVICE_ID}/load`) return next();
    if (req.method === 'GET' && [
      `/${ORDINARY_DEVICE_ID}/receiver-ready`,
      `/${ORDINARY_DEVICE_ID}/receiver-state`,
    ].includes(path)) return next();
    if (req.method === 'POST'
      && path === `/${ORDINARY_DEVICE_ID}/session/transport`
      && VIRTUAL_TRANSPORT_ACTIONS.has(req.body?.action)) return next();
    if (req.method === 'POST'
      && path === `/${ORDINARY_DEVICE_ID}/session/handoff`) return next();
    if (req.method === 'POST'
      && new RegExp(`^/${ORDINARY_DEVICE_ID}/session/item-action/[^/]+/claim$`).test(path)) return next();
    return res.status(403).json({ ok: false, error: 'ordinary acceptance blocks physical device routes' });
  });
  app.use(router);

  return {
    deviceId: ORDINARY_DEVICE_ID,
    eventBus,
    app,
    async attach(httpServer) { await eventBus.start(httpServer); },
    async stop() { commandLiveness.stop(); deviceLiveness.stop(); await eventBus.stop(); },
    async middleware(req, res) {
      const path = new URL(req.url, upstream).pathname;
      if (path.startsWith('/api/v1/device/')) {
        req.url = req.url.replace(/^\/api\/v1\/device/, '') || '/';
        await new Promise(resolve => {
          res.once('finish', resolve);
          app(req, res, () => { res.statusCode = 404; res.end(); });
        });
        return true;
      }
      if (path !== '/api/v1/screens/living-room') return false;
      await fetch(`${upstream}${req.url}`, { headers: { Accept: 'application/json' } })
        .then(async response => {
          res.statusCode = response.status;
          res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
          if (!response.ok) return res.end(await response.text());
          const config = await response.json();
          if (!config?.websocket) return res.end(JSON.stringify(config));
          return res.end(JSON.stringify({ ...config, websocket: {
            ...config.websocket, commands: true, guardrails: { ...config.websocket.guardrails, device: ORDINARY_DEVICE_ID },
          } }));
        })
        .catch(() => { res.statusCode = 502; res.end('Acceptance screen config upstream request failed'); });
      return true;
    },
  };
}
