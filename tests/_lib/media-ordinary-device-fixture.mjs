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
import { EventBusBrowserPlayback } from '../../backend/src/1_adapters/eventbus/EventBusBrowserPlayback.mjs';
import { BrowserPlaybackTracker } from '../../backend/src/3_applications/media/BrowserPlaybackTracker.mjs';
import { SessionControlService } from '../../backend/src/3_applications/devices/services/SessionControlService.mjs';
import { DeviceSessionApiService } from '../../backend/src/3_applications/devices/services/DeviceSessionApiService.mjs';
import { DeviceStartStatusService } from '../../backend/src/3_applications/devices/services/DeviceStartStatusService.mjs';
import { createDeviceRouter } from '../../backend/src/4_api/v1/routers/device.mjs';
import { deviceResolver } from '../../backend/src/4_api/middleware/deviceResolver.mjs';
import { createMediaHouseFixture } from './media-house-fixture.mjs';
import { createMediaHouseholdFixture } from './media-household-fixture.mjs';
import { createIdleSessionSnapshot, validateSessionSnapshot } from '../../shared/contracts/media/shapes.mjs';
import { createDefaultSessionControls } from '../../shared/contracts/media/sessionControls.mjs';

export const ORDINARY_DEVICE_ID = 'acceptance-media';
// A second virtual receiver (batch B: several-screen aim, line up, move
// between two other screens). It is the same real screen page, opened at its
// own screen path in its own browser context; no household screen is used.
export const SECOND_DEVICE_ID = 'acceptance-media-b';
export const SECOND_SCREEN_PATH = 'acceptance-second';
// Phase-1 fixture screens (media proof gaps). Each sits in its OWN room so the
// several-screen drift warning for the first two is not disturbed.
//   speaker  — a speaker-kind receiver (type `speaker`: no picture, no screen-off)
//   offline  — registered but never connects: liveness is uncertain, a send fails honestly
//   power    — has virtual `device_control`: off/on/toggle are answered by the
//              fixture and recorded, never sent to hardware
export const SPEAKER_DEVICE_ID = 'acceptance-speaker';
export const OFFLINE_DEVICE_ID = 'acceptance-offline';
export const POWER_DEVICE_ID = 'acceptance-power';
export const SPEAKER_SCREEN_PATH = 'acceptance-speaker';
export const OFFLINE_SCREEN_PATH = 'acceptance-offline';
export const POWER_SCREEN_PATH = 'acceptance-power';
const VIRTUAL_DEVICES = [
  { id: ORDINARY_DEVICE_ID, name: 'Acceptance receiver', screen: 'living-room' },
  { id: SECOND_DEVICE_ID, name: 'Acceptance second', screen: SECOND_SCREEN_PATH },
  { id: SPEAKER_DEVICE_ID, name: 'Acceptance speaker', screen: SPEAKER_SCREEN_PATH, type: 'speaker', room: 'Acceptance kitchen' },
  { id: OFFLINE_DEVICE_ID, name: 'Acceptance guest room TV', screen: OFFLINE_SCREEN_PATH, room: 'Acceptance guest room', offline: true },
  { id: POWER_DEVICE_ID, name: 'Acceptance den TV', screen: POWER_SCREEN_PATH, room: 'Acceptance den', deviceControl: true },
];
// Both original virtual screens share one room so the several-screen drift
// warning (PLACE.4a/AC6) has something true to say.
export const VIRTUAL_ROOM = 'Acceptance room';
const isVirtual = (id) => VIRTUAL_DEVICES.some((device) => device.id === id);
const VIRTUAL_TRANSPORT_ACTIONS = new Set(['pause', 'play', 'seekAbs', 'seekRel', 'skipNext', 'skipPrev', 'stop', 'goLive']);
// Screen session controls (P1): virtual receiver only, like transport.
const VIRTUAL_SESSION_ROUTES = [
  ['PUT', /^\/session\/(add-only|end-of-queue|stop-after-current|volume)$/],
  // Steering a virtual screen's queue (item actions such as remove/clear, edits, Undo) and its shuffle/repeat.
  // Plain queue play-now/add stay closed: starting content uses the ordinary load route.
  ['POST', /^\/session\/queue\/(undo|remove|reorder|jump|clear|item-action)$/],
  ['PUT', /^\/session\/(shuffle|repeat)$/],
  ['POST', /^\/session\/(sleep-timer|sleep-timer\/cancel|sleep-timer\/resume|put-back|countdown\/cancel|countdown\/start-now|claim)$/],
  ['GET', /^\/start-status$/],
  // Player features (P2): tracks, Show briefly, music behind.
  ['POST', /^\/session\/(tracks|brief\/close|music-behind)$/],
];

/**
 * Scripted receiver states (media proof gaps, Phase 2b).
 *
 * A registered virtual screen that has NO mounted page can be put into any
 * receiver state by publishing the same `device-state` broadcast a real screen
 * would: playing/paused/idle/off, started by another device or a routine, with
 * live, slideshow or photo content, or a duration-less item (a capability
 * limit: no seek). Nothing here answers commands: a move from such a screen
 * fails honestly (the source cannot be reached) and the screen keeps its
 * state. Never script a screen whose page a journey has mounted.
 *
 * @param {Object} spec
 * @param {'playing'|'paused'|'idle'|'off'} [spec.state='playing']
 * @param {string} [spec.title] item title
 * @param {string} [spec.contentId]
 * @param {number|null} [spec.duration] seconds; null = unknown (no seeking)
 * @param {number} [spec.position]
 * @param {string} [spec.thumbnail] picture url of the current item
 * @param {Array<{kind?:string,label:string,count?:number,origin?:object,putBack?:boolean}>} [spec.notes] screen notes, grouped by count (what a speaker records on its house row)
 * @param {number} [spec.heartbeatMs=10000] how often it keeps reporting; 0 = silent after the first report
 * @param {'video'|'audio'|'photo'|'slideshow'|'live'} [spec.kind='video']
 * @param {{kind:'device',id:string}|{kind:'routine',name:string}} [spec.origin]
 * @param {Array<{title:string,contentId?:string,kind?:string}>} [spec.queue] items after the current one
 */
export function buildScriptedSnapshot(deviceId, spec = {}) {
  // `off` is not a SessionSnapshot state (the contract's idle state is `idle`): an off screen reports
  // idle; `off` is the same snapshot from a screen that then goes silent (scriptReceiver).
  const state = spec.state === 'off' ? 'idle' : (spec.state ?? 'playing');
  const snapshot = createIdleSessionSnapshot({ sessionId: `scripted-${deviceId}`, ownerId: deviceId });
  const kind = spec.kind ?? 'video';
  const item = (entry, index) => ({
    contentId: entry.contentId ?? `scripted:${deviceId}:${index}`,
    title: entry.title ?? `Scripted item ${index + 1}`,
    format: (entry.kind ?? kind) === 'audio' ? 'audio' : ((entry.kind ?? kind) === 'photo' || (entry.kind ?? kind) === 'slideshow') ? 'image' : 'video',
    mediaType: entry.kind ?? kind,
  });
  if (state === 'idle') {
    snapshot.state = state;
  } else {
    const current = {
      ...item({ contentId: spec.contentId, title: spec.title ?? 'Scripted item', kind }, 0),
      ...(spec.thumbnail ? { thumbnail: spec.thumbnail } : {}),
      ...(kind === 'live' ? { isLive: true } : {}),
      ...(spec.duration === null || kind === 'live' ? {} : { duration: spec.duration ?? 600 }),
    };
    const rest = (spec.queue ?? []).map((entry, index) => item(entry, index + 1));
    snapshot.state = state;
    snapshot.currentItem = current;
    snapshot.position = kind === 'live' ? 0 : (spec.position ?? 0);
    snapshot.queue = {
      items: [current, ...rest].map((entry, index) => ({ queueItemId: `scripted-${deviceId}-${index}`, ...entry })),
      currentIndex: 0,
      upNextCount: 0,
    };
  }
  // Screen notes ("Paused by …", grouped by count) a screen that cannot show them records on its house row.
  if (Array.isArray(spec.notes) && spec.notes.length) {
    snapshot.controls = {
      ...createDefaultSessionControls(),
      notes: spec.notes.map((note, index) => ({
        id: note.id ?? `scripted-note-${index}`, kind: note.kind ?? 'paused', label: note.label ?? 'Changed',
        count: note.count ?? 1, at: new Date().toISOString(),
        ...(note.origin ? { origin: note.origin } : {}),
        putBack: note.putBack === false ? null : { availableUntil: new Date(Date.now() + 10 * 60_000).toISOString() },
      })),
    };
  }
  snapshot.meta = {
    ownerId: deviceId,
    updatedAt: new Date().toISOString(),
    ...(spec.origin ? { origin: spec.origin } : {}),
  };
  return snapshot;
}

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
// `expireNow` lets the fixture publish one heartbeat for a screen and have its
// offline timer fire at once (the screen "was seen, then went silent").
const timers = { expireNow: false };
const scheduler = {
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  after: (ms, fn) => { const timer = setTimeout(fn, timers.expireNow ? 0 : ms); return () => clearTimeout(timer); },
  withDeadline: (promise) => promise,
};

// This is deliberately not a browser-driving substitute for a real device:
// it can only prepare an already-mounted receiver. A missing WS receiver
// fails closed rather than loading a physical device or inventing success.
function virtualReceiver(eventBus, logger, deviceId = ORDINARY_DEVICE_ID, screen = 'living-room', onVolume = () => {}, onPower = null, wakeFails = () => false) {
  const content = new WebSocketContentAdapter({
    deviceId,
    topic: `homeline:${deviceId}`,
  }, { wsBus: eventBus, logger });
  return {
    screenPath: `/screen/${screen}`,
    defaultVolume: null,
    // Volume is the one virtual device capability every screen has: a load that
    // names a volume (a routine's "chosen volume") runs the real volume step, and
    // the level is recorded (readable at /<id>/device-control-calls), never sent anywhere.
    hasCapability: (capability) => capability === 'volume' || (Boolean(onPower) && capability === 'deviceControl'),
    setVolume: async (level) => { onVolume(deviceId, level); return { ok: true, virtual: true, level }; },
    // A screen with virtual device_control wakes for real (the "Turning on" step runs and is recorded,
    // never sent to hardware); every other virtual screen has no device control to wake.
    // A TV takes a moment to wake: the step is observable ("Turning on TV…") rather than instantaneous.
    powerOn: async () => {
      if (!onPower) return { ok: true, skipped: 'no_device_control' };
      onPower(deviceId);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      // `wake: 'fail'` (see the fixture's wake route): the TV does not come on, so the send fails outright.
      if (wakeFails(deviceId)) return { ok: false, error: 'tv_did_not_turn_on', elapsedMs: 1500 };
      return { ok: true, verified: true, elapsedMs: 1500 };
    },
    prepareForContent: async (options) => ({ ...(await content.prepareForContent(options)), coldRestart: false, cameraSkipped: true }),
    // WakeAndLoad's ordinary warm path broadcasts directly after positive
    // subscriber+liveness proof. This real adapter is the service's cold/fallback
    // path; it never navigates hardware or manufactures an acknowledgement.
    loadContent: async (_path, query) => content.load(_path, query),
  };
}

/**
 * @param {Object} options
 * @param {string} options.upstream
 * @param {Object} [options.catalog] - a (real or stub) content catalog gateway. With it the
 *   household routes (`/api/v1/media/household/*`, `/suggestions`) run the REAL household
 *   services over a seeded throwaway data dir; without it they are not mounted.
 */
export function createMediaOrdinaryDeviceFixture({ upstream, logger = quiet, catalog = null } = {}) {
  if (!upstream) throw new Error('createMediaOrdinaryDeviceFixture requires upstream');
  const eventBus = new WebSocketEventBus({ logger });
  registerClientIngress({ eventBus, logger });
  const presenceGateway = new EventBusDeviceTransportGateway({ eventBus });
  const deviceLiveness = new DeviceLivenessService({
    presenceGateway, logger, scheduler, offlineTimeoutMs: 60_000,
  });
  deviceLiveness.start();
  eventBus.setLivenessService(deviceLiveness);
  // The offline screen: registered, heard from once, then silent for good. Its
  // liveness reads online:false (never online again: nothing connects as it).
  for (const { id } of VIRTUAL_DEVICES.filter((device) => device.offline)) {
    timers.expireNow = true;
    try {
      presenceGateway.publishDeviceState({
        deviceId: id, reason: 'initial', ts: new Date().toISOString(),
        snapshot: { state: 'stopped', currentItem: null, position: 0, queue: { items: [], currentIndex: -1 }, config: {} },
      });
    } finally { timers.expireNow = false; }
  }
  const commandLiveness = new CommandHandlerLivenessService({ presenceGateway, logger });
  commandLiveness.start();
  const startStatus = new DeviceStartStatusService({ progressGateway: presenceGateway, logger });
  startStatus.start();
  eventBus.setStartStatusService(startStatus);
  // Seeded household (real services over a temp data dir), when a catalog is given.
  const household = catalog ? createMediaHouseholdFixture({ catalog, livenessService: deviceLiveness, logger }) : null;
  // House contracts (screens, routines, started by) for the house view.
  // What each browser tab says it plays and who started it, as the real composition tracks it.
  const browserPlayback = new BrowserPlaybackTracker();
  new EventBusBrowserPlayback({ eventBus, tracker: browserPlayback }).attach();
  const house = createMediaHouseFixture({
    browserPlayback,
    deviceId: ORDINARY_DEVICE_ID, name: 'Acceptance receiver', room: 'Virtual browser', deviceLiveness, logger,
    household,
    registrySeed: household?.seeded.registry ?? null,
    routineSnapshot: household?.seeded.routines ?? null,
    // The second original receiver stays out of the registry (as before this phase);
    // the three Phase-1 screens are registered with their own rooms.
    extraScreens: VIRTUAL_DEVICES.filter(({ id }) => ![ORDINARY_DEVICE_ID, SECOND_DEVICE_ID].includes(id)).map(({ id, name, type, room, deviceControl }) => ({
      id: `fleet:${id}`, screenId: id, name, room: room ?? 'Virtual browser', type: type ?? 'websocket-screen', wakeable: Boolean(deviceControl),
    })),
  });
  house.warm();
  const deviceControlCalls = [];
  const wakeFailures = new Set();
  const recordVolume = (deviceId, level) => deviceControlCalls.push({ deviceId, action: 'volume', level: Number(level), at: new Date().toISOString() });
  const recordWake = (deviceId) => deviceControlCalls.push({ deviceId, action: 'on', via: 'wake', at: new Date().toISOString() });
  const receivers = new Map(VIRTUAL_DEVICES.map(({ id, screen, deviceControl }) => [id, virtualReceiver(eventBus, logger, id, screen, recordVolume, deviceControl ? recordWake : null, (deviceId) => wakeFailures.has(deviceId))]));
  const deviceService = { get: (id) => receivers.get(id) ?? null };
  // Wired as in production (bootstrap): the adopt load (§4.7) needs it.
  const sessionControl = new SessionControlService({
    transportGateway: presenceGateway,
    livenessService: deviceLiveness,
    logger,
  });
  const wakeAndLoadService = new WakeAndLoadService({
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
  // As in production (mediaHouse composition): the REAL load recorder sits in
  // front of the wake-and-load, so a Home Assistant caller is classified,
  // matched to the routine catalog, deduped and written to the routine history.
  const wakeAndLoad = house.wrapWakeAndLoad(wakeAndLoadService);
  const dispatchService = new DeviceContentDispatchService({
    wakeAndLoad,
    configuration,
    idempotency: new DispatchIdempotencyService({ clock: { now: () => Date.now() }, logger }),
    logger,
  });
  const fleetService = {
    configuration: () => ({ devices: Object.fromEntries(VIRTUAL_DEVICES.map(({ id, name, screen, type, deviceControl }) => [id, {
      name, location: 'Virtual browser', icon: type === 'speaker' ? 'speaker' : 'tv', fleet: true,
      ...(type ? { type } : {}),
      content_control: { type: 'websocket' }, screen_path: `/screen/${screen}`,
      // Virtual power: the fixture answers /on /off /toggle itself (never hardware).
      ...(deviceControl ? { device_control: { virtual: true } } : {}),
    }])) }),
    list: () => VIRTUAL_DEVICES.map(({ id, name }) => ({ id, name, fleet: true })),
  };
  const unavailable = { configured: () => false };
  const sessionService = new DeviceSessionApiService({ sessionControl, logger });
  const router = createDeviceRouter({
    fleetService, dispatchService, presenceService: unavailable, sessionService,
    screenService: unavailable, recoveryService: unavailable, startStatusService: startStatus,
  });
  const app = express();
  app.use(express.json());
  // As in production: the X-Daylight-Device header names the asking device,
  // which the device router turns into the command origin.
  app.use(deviceResolver());
  // Virtual device_control (the screen-off / power routes): recorded, never
  // sent anywhere. The calls are readable over HTTP because the journeys run
  // in a different process from this server.
  for (const { id } of VIRTUAL_DEVICES.filter((device) => device.deviceControl)) {
    for (const action of ['on', 'off', 'toggle']) {
      app.get(`/${id}/${action}`, (req, res) => {
        const call = { deviceId: id, action, at: new Date().toISOString(), query: { ...req.query } };
        deviceControlCalls.push(call);
        logger.info?.('acceptance.device-control.virtual', call);
        return res.json({ ok: true, deviceId: id, action, virtual: true });
      });
    }
  }
  for (const { id } of VIRTUAL_DEVICES) {
    app.get(`/${id}/device-control-calls`, (_req, res) => res.json({ calls: deviceControlCalls.filter((c) => c.deviceId === id) }));
  }
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
      && new RegExp(`^/${id}/session/item-action/[^/]+/(claim|cancel)$`).test(path)) return next();
    return res.status(403).json({ ok: false, error: 'ordinary acceptance blocks physical device routes' });
  });
  // As in production: the device router runs inside the request context, so the
  // load recorder can tell a Home Assistant User-Agent from a person.
  app.use(house.withRequestContext(router));

  // Scripted receiver states (see buildScriptedSnapshot). Published as the
  // screen itself would; `off` is the screen heard once and then silent.
  const scripted = new Set();
  // `serverOffline: true` on a scripted screen: the screen keeps reporting, so a person's device still shows it
  // playing, but the server's own liveness gate says it is offline, so a send is refused with DEVICE_OFFLINE
  // (the screen "looks online but cannot be reached").
  const serverOffline = new Set();
  const realLastSnapshot = deviceLiveness.getLastSnapshot.bind(deviceLiveness);
  deviceLiveness.getLastSnapshot = (deviceId) => {
    const last = realLastSnapshot(deviceId);
    return last && serverOffline.has(deviceId) ? { ...last, online: false } : last;
  };
  const beats = new Map();
  const stopBeat = (deviceId) => { clearInterval(beats.get(deviceId)); beats.delete(deviceId); };
  /**
   * A scripted screen keeps reporting like a real one (a heartbeat every `heartbeatMs`, default 10 s, inside the app's 15 s stale rule), so it
   * stays in its state beyond the liveness timeout. `heartbeatMs: 0` = said once and then silent (it goes
   * Off at the liveness timeout), for journeys about a screen that stopped reporting.
   */
  function scriptReceiver(deviceId, spec = {}) {
    if (!isVirtual(deviceId)) throw new Error(`scriptReceiver: ${deviceId} is not a virtual fixture screen`);
    const snapshot = buildScriptedSnapshot(deviceId, spec);
    const validation = validateSessionSnapshot(snapshot);
    if (!validation.valid) throw new Error(`scriptReceiver: invalid snapshot: ${validation.errors.join('; ')}`);
    scripted.add(deviceId);
    if (spec.serverOffline === true) serverOffline.add(deviceId); else serverOffline.delete(deviceId);
    stopBeat(deviceId);
    timers.expireNow = spec.state === 'off';
    try {
      presenceGateway.publishDeviceState({
        deviceId, reason: spec.state === 'off' ? 'initial' : 'change', ts: new Date().toISOString(), snapshot,
      });
    } finally { timers.expireNow = false; }
    const heartbeatMs = spec.heartbeatMs ?? 10_000;
    if (spec.state !== 'off' && heartbeatMs > 0) {
      const beat = setInterval(() => presenceGateway.publishDeviceState({
        deviceId, reason: 'heartbeat', ts: new Date().toISOString(),
        snapshot: { ...snapshot, meta: { ...snapshot.meta, updatedAt: new Date().toISOString() } },
      }), heartbeatMs);
      beat.unref?.();
      beats.set(deviceId, beat);
    }
    return snapshot;
  }
  const reset = (options) => {
    household?.reset(options); house.reset(); house.warm(); deviceControlCalls.length = 0; wakeFailures.clear();
    // A scripted screen goes quiet again: idle snapshot, so no journey inherits a busy screen.
    for (const deviceId of scripted) {
      stopBeat(deviceId);
      if (deviceId === OFFLINE_DEVICE_ID) continue;
      presenceGateway.publishDeviceState({
        deviceId, reason: 'change', ts: new Date().toISOString(),
        snapshot: buildScriptedSnapshot(deviceId, { state: 'idle' }),
      });
    }
    scripted.clear();
    serverOffline.clear();
  };
  return {
    deviceId: ORDINARY_DEVICE_ID,
    eventBus,
    app,
    house,
    household,
    deviceLiveness,
    deviceControlCalls,
    /** Put household, registry, routine history and recorded device-control calls back to the seed (`{ empty: true }`: household that played nothing). */
    reset,
    scriptReceiver,
    async attach(httpServer) { await eventBus.start(httpServer); },
    async stop() { for (const deviceId of [...beats.keys()]) stopBeat(deviceId); startStatus.stop(); commandLiveness.stop(); deviceLiveness.stop(); await eventBus.stop(); household?.cleanup(); },
    async middleware(req, res) {
      const path = new URL(req.url, upstream).pathname;
      // Journeys share one server: this puts the seeded household back between them.
      if (path === '/api/v1/media/_fixture/reset' && req.method === 'POST') {
        // `?seed=empty`: a household that has played nothing yet.
        reset({ empty: new URL(req.url, upstream).searchParams.get('seed') === 'empty' });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
        return true;
      }
      // `POST /api/v1/media/_fixture/receiver` {deviceId, ...spec}: put a fixture
      // screen with no mounted page into a receiver state (see scriptReceiver).
      if (path === '/api/v1/media/_fixture/receiver' && req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        res.setHeader('Content-Type', 'application/json');
        try {
          const { deviceId, ...spec } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          const snapshot = scriptReceiver(deviceId, spec);
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, deviceId, state: snapshot.state }));
        } catch (error) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: error.message }));
        }
        return true;
      }
      // `POST /api/v1/media/_fixture/wake` {deviceId, fail}: the (virtual device_control) screen's wake step fails, so a
      // send to it fails outright (a failed attempt with Retry), instead of timing out as "may not have started".
      if (path === '/api/v1/media/_fixture/wake' && req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        res.setHeader('Content-Type', 'application/json');
        try {
          const { deviceId, fail = true } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (!VIRTUAL_DEVICES.some((d) => d.id === deviceId && d.deviceControl)) throw new Error(`${deviceId} has no virtual device control`);
          if (fail) wakeFailures.add(deviceId); else wakeFailures.delete(deviceId);
          res.statusCode = 200; res.end(JSON.stringify({ ok: true, deviceId, fail }));
        } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ ok: false, error: error.message })); }
        return true;
      }
      if (household?.handles(path)) {
        await household.serve(req, res);
        return true;
      }
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
