import express from 'express';
import { randomUUID } from 'node:crypto';
import { WebSocketEventBus } from '../../backend/src/1_adapters/eventbus/WebSocketEventBus.mjs';
import { WebSocketContentAdapter } from '../../backend/src/1_adapters/devices/WebSocketContentAdapter.mjs';
import { EventBusDeviceTransportGateway } from '../../backend/src/1_adapters/devices/EventBusDeviceTransportGateway.mjs';
import { registerClientIngress } from '../../backend/src/5_composition/modules/clientIngress.mjs';
import { WakeAndLoadService } from '../../backend/src/3_applications/devices/services/WakeAndLoadService.mjs';
import { DeviceContentDispatchService } from '../../backend/src/3_applications/devices/services/DeviceContentDispatchService.mjs';
import { DeviceLivenessService } from '../../backend/src/3_applications/devices/services/DeviceLivenessService.mjs';
import { CommandHandlerLivenessService } from '../../backend/src/3_applications/devices/services/CommandHandlerLivenessService.mjs';
import { DispatchIdempotencyService } from '../../backend/src/3_applications/devices/services/DispatchIdempotencyService.mjs';
import { SessionControlService } from '../../backend/src/3_applications/devices/services/SessionControlService.mjs';
import { DeviceSessionApiService } from '../../backend/src/3_applications/devices/services/DeviceSessionApiService.mjs';
import { DeviceStartStatusService } from '../../backend/src/3_applications/devices/services/DeviceStartStatusService.mjs';
import { createDeviceRouter } from '../../backend/src/4_api/v1/routers/device.mjs';
import { deviceResolver } from '../../backend/src/4_api/middleware/deviceResolver.mjs';
import { createMediaHouseFixture } from './media-house-fixture.mjs';

export const ORDINARY_DEVICE_ID = 'acceptance-media';
// A second virtual receiver (batch B: several-screen aim, line up, move
// between two other screens). It is the same real screen page, opened at its
// own screen path in its own browser context; no household screen is used.
export const SECOND_DEVICE_ID = 'acceptance-media-b';
export const SECOND_SCREEN_PATH = 'acceptance-second';
const VIRTUAL_DEVICES = [
  { id: ORDINARY_DEVICE_ID, name: 'Acceptance receiver', screen: 'living-room' },
  { id: SECOND_DEVICE_ID, name: 'Acceptance second', screen: SECOND_SCREEN_PATH },
];
// Both virtual screens share one room so the several-screen drift warning
// (PLACE.4a/AC6) has something true to say.
export const VIRTUAL_ROOM = 'Acceptance room';
const isVirtual = (id) => VIRTUAL_DEVICES.some((device) => device.id === id);
const VIRTUAL_TRANSPORT_ACTIONS = new Set(['pause', 'play', 'seekAbs', 'seekRel', 'skipNext', 'skipPrev', 'stop']);
// Screen session controls (P1): virtual receiver only, like transport.
const VIRTUAL_SESSION_ROUTES = [
  ['PUT', /^\/session\/(add-only|end-of-queue|stop-after-current|volume)$/],
  ['POST', /^\/session\/(sleep-timer|sleep-timer\/cancel|sleep-timer\/resume|put-back|countdown\/cancel|countdown\/start-now|claim)$/],
  ['GET', /^\/start-status$/],
  // Player features (P2): tracks, Show briefly, music behind.
  ['POST', /^\/session\/(tracks|brief\/close|music-behind)$/],
];
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const scheduler = {
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  after: (ms, fn) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); },
  withDeadline: (promise) => promise,
};

// This is deliberately not a browser-driving substitute for a real device:
// it can only prepare an already-mounted receiver. A missing WS receiver
// fails closed rather than loading a physical device or inventing success.
function virtualReceiver(eventBus, logger, deviceId = ORDINARY_DEVICE_ID, screen = 'living-room') {
  const content = new WebSocketContentAdapter({
    deviceId,
    topic: `homeline:${deviceId}`,
  }, { wsBus: eventBus, logger });
  return {
    screenPath: `/screen/${screen}`,
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
  registerClientIngress({ eventBus, logger });
  const presenceGateway = new EventBusDeviceTransportGateway({ eventBus });
  const deviceLiveness = new DeviceLivenessService({
    presenceGateway, logger, scheduler, offlineTimeoutMs: 60_000,
  });
  deviceLiveness.start();
  eventBus.setLivenessService(deviceLiveness);
  const commandLiveness = new CommandHandlerLivenessService({ presenceGateway, logger });
  commandLiveness.start();
  const startStatus = new DeviceStartStatusService({ progressGateway: presenceGateway, logger });
  startStatus.start();
  eventBus.setStartStatusService(startStatus);
  const receivers = new Map(VIRTUAL_DEVICES.map(({ id, screen }) => [id, virtualReceiver(eventBus, logger, id, screen)]));
  const deviceService = { get: (id) => receivers.get(id) ?? null };
  // Wired as in production (bootstrap): the adopt load (§4.7) needs it.
  const sessionControl = new SessionControlService({
    transportGateway: presenceGateway,
    livenessService: deviceLiveness,
    logger,
  });
  const wakeAndLoad = new WakeAndLoadService({
    deviceService,
    sessionControlService: sessionControl,
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
    device: (id) => isVirtual(id) ? { id, content_control: { type: 'websocket' }, fleet: true } : null,
  };
  const dispatchService = new DeviceContentDispatchService({
    wakeAndLoad,
    configuration,
    idempotency: new DispatchIdempotencyService({ clock: { now: () => Date.now() }, logger }),
    logger,
  });
  const fleetService = {
    configuration: () => ({ devices: Object.fromEntries(VIRTUAL_DEVICES.map(({ id, name, screen }) => [id, {
      name, location: 'Virtual browser', icon: 'tv', fleet: true,
      content_control: { type: 'websocket' }, screen_path: `/screen/${screen}`,
    }])) }),
    list: () => VIRTUAL_DEVICES.map(({ id, name }) => ({ id, name, fleet: true })),
  };
  const unavailable = { configured: () => false };
  const sessionService = new DeviceSessionApiService({ sessionControl, logger });
  const router = createDeviceRouter({
    fleetService, dispatchService, presenceService: unavailable, sessionService,
    screenService: unavailable, recoveryService: unavailable, startStatusService: startStatus,
  });
  // House contracts (screens, routines, started by) for the house view.
  const house = createMediaHouseFixture({
    deviceId: ORDINARY_DEVICE_ID, name: 'Acceptance receiver', room: 'Virtual browser', deviceLiveness, logger,
  });
  const app = express();
  app.use(express.json());
  // As in production: the X-Daylight-Device header names the asking device,
  // which the device router turns into the command origin.
  app.use(deviceResolver());
  for (const { id } of VIRTUAL_DEVICES) {
    app.get(`/${id}/receiver-ready`, (_req, res) => {
      const subscribers = eventBus.getTopicSubscriberCount(`homeline:${id}`);
      return res.json({ ready: subscribers > 0 && commandLiveness.isFresh(id), subscribers });
    });
    app.get(`/${id}/receiver-state`, (_req, res) => {
      const state = deviceLiveness.getLastSnapshot(id);
      return state ? res.json(state) : res.status(404).json({ error: 'receiver has not published state' });
    });
  }
  app.use((req, res, next) => {
    const path = req.path;
    if (req.method === 'GET' && path === '/config') return next();
    const id = VIRTUAL_DEVICES.map((device) => device.id).find((candidate) => path.startsWith(`/${candidate}/`));
    if (!id) return res.status(403).json({ ok: false, error: 'ordinary acceptance blocks physical device routes' });
    if (req.method === 'GET' && path === `/${id}/load`) return next();
    // The adopt load (§4.7): a move to an idle virtual screen.
    if (req.method === 'POST' && path === `/${id}/load` && req.body?.mode === 'adopt') return next();
    if (req.method === 'GET' && [`/${id}/receiver-ready`, `/${id}/receiver-state`].includes(path)) return next();
    if (req.method === 'POST'
      && path === `/${id}/session/transport`
      && VIRTUAL_TRANSPORT_ACTIONS.has(req.body?.action)) return next();
    if (req.method === 'POST' && path === `/${id}/session/handoff`) return next();
    const rest = path.slice(id.length + 1);
    if (VIRTUAL_SESSION_ROUTES.some(([method, pattern]) => method === req.method && pattern.test(rest))) return next();
    if (req.method === 'POST'
      && new RegExp(`^/${id}/session/item-action/[^/]+/claim$`).test(path)) return next();
    return res.status(403).json({ ok: false, error: 'ordinary acceptance blocks physical device routes' });
  });
  app.use(router);

  return {
    deviceId: ORDINARY_DEVICE_ID,
    eventBus,
    app,
    async attach(httpServer) { await eventBus.start(httpServer); },
    async stop() { startStatus.stop(); commandLiveness.stop(); deviceLiveness.stop(); await eventBus.stop(); },
    async middleware(req, res) {
      const path = new URL(req.url, upstream).pathname;
      if (house.handles(path)) {
        await house.serve(req, res);
        return true;
      }
      if (path.startsWith('/api/v1/device/')) {
        req.url = req.url.replace(/^\/api\/v1\/device/, '') || '/';
        await new Promise(resolve => {
          res.once('finish', resolve);
          app(req, res, () => { res.statusCode = 404; res.end(); });
        });
        return true;
      }
      // The screen registry for the virtual screens only (§2.5): their room,
      // for the several-screen drift warning. Household screens are not listed.
      if (path === '/api/v1/media/screens' && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ screens: VIRTUAL_DEVICES.map(({ id, name }) => ({
          id: `fleet:${id}`, kind: 'screen', screenId: id, name, room: VIRTUAL_ROOM, configured: true,
          online: true, aliases: [],
        })), notSeenLately: [], retired: [] }));
        return true;
      }
      const virtualScreen = VIRTUAL_DEVICES.find(({ screen }) => path === `/api/v1/screens/${screen}`);
      if (!virtualScreen) return false;
      // Every virtual screen reads the living-room screen config, re-pointed
      // at its own virtual device id.
      await fetch(`${upstream}/api/v1/screens/living-room`, { headers: { Accept: 'application/json' } })
        .then(async response => {
          res.statusCode = response.status;
          res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
          if (!response.ok) return res.end(await response.text());
          const config = await response.json();
          if (!config?.websocket) return res.end(JSON.stringify(config));
          return res.end(JSON.stringify({ ...config, websocket: {
            ...config.websocket, commands: true, guardrails: { ...config.websocket.guardrails, device: virtualScreen.id },
          } }));
        })
        .catch(() => { res.statusCode = 502; res.end('Acceptance screen config upstream request failed'); });
      return true;
    },
  };
}
