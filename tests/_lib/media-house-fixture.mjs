/**
 * House contracts for the ordinary-device acceptance fixture (tech doc
 * §2.5–2.7): the REAL media house router and its REAL screen registry,
 * routine catalog, routine history, routine-load recorder and "started by"
 * services, wired to in-memory stores and to the fixture's own device
 * liveness. Nothing here reads or writes the household's screens.yml /
 * routine history, and the only screens it knows are the fixture's virtual
 * ones (`screens`) plus registry-only seeds.
 *
 * The routine catalog is a snapshot (what a Home Assistant import would have
 * stored) so the REAL RoutineCatalogService answers; the history is seeded
 * with one failed and one started run, so the routine views have something
 * true to show. `wrapWakeAndLoad` puts the REAL RoutineLoadRecorder (Home
 * Assistant User-Agent -> routine origin -> catalog match -> history, with
 * the 10-second dedupe) in front of the device fixture's wake-and-load.
 *
 * With a `household` (media-household-fixture.mjs) the playback and
 * suggestion routes read the real household memory and seeded play ledger;
 * without one (unit tests) they fall back to an empty ledger.
 */
import express from 'express';
import { createMediaHouseRouter } from '../../backend/src/4_api/v1/routers/mediaHouse.mjs';
import { ScreenRegistryService } from '../../backend/src/3_applications/media/ScreenRegistryService.mjs';
import { ScreenSignalsReader } from '../../backend/src/3_applications/media/ScreenSignalsReader.mjs';
import { RoutineCatalogService } from '../../backend/src/3_applications/media/RoutineCatalogService.mjs';
import { RoutineHistoryService } from '../../backend/src/3_applications/media/RoutineHistoryService.mjs';
import { RoutineLoadRecorder } from '../../backend/src/3_applications/media/RoutineLoadRecorder.mjs';
import { LoadOriginHints } from '../../backend/src/3_applications/media/LoadOriginHints.mjs';
import { RoutineTriggerDedupeService } from '../../backend/src/3_applications/devices/services/RoutineTriggerDedupeService.mjs';
import { ScreenPlaybackService } from '../../backend/src/3_applications/media/ScreenPlaybackService.mjs';
import { buildRoutineRun } from '../../backend/src/2_domains/media/routineHistory.mjs';
import { currentRequestContext } from '../../backend/src/0_system/runtime/requestContext.mjs';
import { withRequestContext } from '../../backend/src/0_system/http/middleware/requestContext.mjs';

/** The one title the acceptance server authorizes for these journeys (Arrival; see BRANCH_ALLOWED_TITLES). */
export const HOUSE_FIXTURE_TITLE = Object.freeze({ id: 'plex:55854', query: 'arrival' });

export const HOUSE_FIXTURE_ROUTINE = Object.freeze({
  id: 'automation:acceptance_button', name: 'Acceptance button: Morning', kind: 'automation', source: 'fixture',
});

function memoryStore(initial) {
  const first = structuredClone(initial);
  let state = structuredClone(first);
  return {
    load: async () => structuredClone(state),
    save: async (next) => { state = structuredClone(next); },
    reset: () => { state = structuredClone(first); },
  };
}

function snapshotStore(routines) {
  const first = { routines: structuredClone(routines), importedAt: new Date().toISOString(), source: 'fixture' };
  let snapshot = structuredClone(first);
  return {
    load: async () => structuredClone(snapshot),
    save: async (next) => { snapshot = structuredClone(next); },
    reset: () => { snapshot = structuredClone(first); },
  };
}

/**
 * @param {Object} deps
 * @param {Array<{id, screenId, name, room, type?, wakeable?}>} [deps.extraScreens] - more configured screens
 * @param {Object} [deps.registrySeed] - registry-only screens ({screens, aliases})
 * @param {Object[]} [deps.routineSnapshot] - the routine catalog (default: the one fixture routine)
 * @param {Object} [deps.household] - seeded household (media-household-fixture.mjs)
 */
export function createMediaHouseFixture({
  deviceId, name, room, deviceLiveness, logger, extraScreens = [], registrySeed = null, routineSnapshot = null, household = null, browserPlayback = null,
}) {
  const screenId = `fleet:${deviceId}`;
  const configured = [
    { id: screenId, screenId: deviceId, name, room, type: 'websocket-screen', wakeable: false },
    ...extraScreens,
  ];
  const routines = routineSnapshot ?? [{ ...HOUSE_FIXTURE_ROUTINE, targets: [{ deviceId: screenId, screenId: deviceId, query: 'queue=morning-program' }], via: [] }];
  const snapshots = snapshotStore(routines);
  const historyStore = memoryStore([]);
  const playLedger = household?.playLedger ?? { plays: async () => [] };
  const catalog = new RoutineCatalogService({ snapshots, history: historyStore, playLedger, logger });
  const registryStore = memoryStore(registrySeed ?? { screens: {}, aliases: {} });
  const signals = new ScreenSignalsReader({
    livenessService: typeof deviceLiveness?.knownDeviceIds === 'function' ? deviceLiveness : null,
    playLedger: household?.playLedger ?? null,
    logger,
  });
  const screens = new ScreenRegistryService({
    store: registryStore,
    configuredScreens: { list: () => configured },
    signals,
    progress: household?.progress ?? null,
    routines: catalog,
    logger,
  });
  household?.bindScreens?.(screens);
  const history = new RoutineHistoryService({ store: historyStore, catalog, screens, playLedger, logger });
  const now = Date.now();
  const first = routines[0];
  const seedRuns = () => [
    buildRoutineRun({ at: new Date(now - 3 * 3600_000).toISOString(), routine: HOUSE_FIXTURE_ROUTINE, deviceId: screenId,
      screenName: name, query: { queue: 'morning-program' }, result: { ok: true, dispatchId: 'seed-started' } }),
    buildRoutineRun({ at: new Date(now - 3600_000).toISOString(), routine: HOUSE_FIXTURE_ROUTINE, deviceId: screenId,
      screenName: name, query: { queue: 'morning-program' }, result: { ok: false, failedStep: 'load', error: 'no subscriber', dispatchId: 'seed-failed' } }),
  ];
  const seedHistory = async () => historyStore.save(first ? seedRuns() : []);
  seedHistory();
  historyStore.reset = () => { seedHistory(); };
  // "Started by" reads the screen's live session snapshot (meta.origin) first.
  const memory = household?.memory ?? {
    nowPlaying: async () => {
      const entry = deviceLiveness.getLastSnapshot(deviceId);
      const snap = entry?.online ? entry.snapshot : null;
      const playing = snap && ['playing', 'paused', 'buffering'].includes(snap.state) && snap.currentItem?.contentId;
      return { list: playing ? [{ deviceId: screenId, contentId: snap.currentItem.contentId, title: snap.currentItem.title ?? null }] : [] };
    },
  };
  const playback = new ScreenPlaybackService({ playLedger, livenessService: deviceLiveness, memory, screens, browserPlayback, logger });
  const originHints = household?.originHints ?? new LoadOriginHints();
  const dedupe = new RoutineTriggerDedupeService();
  const app = express();
  app.use(express.json());
  app.use(createMediaHouseRouter({
    screenRegistry: screens, routineCatalog: catalog, routineHistory: history, screenPlayback: playback,
    suggestions: household?.suggestions ?? null, logger,
  }));
  const HOUSE_PATH = /^\/api\/v1\/media\/(screens|started-by|routines|suggestions)(\/|\?|$)/;
  return {
    app,
    screens,
    routineCatalog: catalog,
    routineHistory: history,
    originHints,
    /** Warm the catalog: the load path only ever reads a cache hit (peekMatch). */
    warm: () => catalog.list({}),
    /** The REAL load recorder in front of a wake-and-load (Home Assistant -> routine origin). */
    wrapWakeAndLoad: (wakeAndLoad) => new RoutineLoadRecorder({
      wakeAndLoad, context: currentRequestContext, catalog, history, hints: originHints, dedupe, logger,
    }),
    /** Wrap an Express handler so the recorder sees the caller's User-Agent / device header. */
    withRequestContext,
    handles: (path) => HOUSE_PATH.test(path),
    /** Put the registry, routine catalog and routine history back to their seeds. */
    reset() { registryStore.reset(); snapshots.reset(); historyStore.reset(); catalog.invalidate(); },
    async serve(req, res) {
      req.url = req.url.replace(/^\/api\/v1\/media/, '') || '/';
      await new Promise((resolve) => {
        res.once('finish', resolve);
        app(req, res, () => { res.statusCode = 404; res.end(); });
      });
    },
  };
}
