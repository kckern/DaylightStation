/**
 * House contracts for the ordinary-device acceptance fixture (tech doc
 * §2.5–2.7): the REAL media house router and its REAL screen registry,
 * routine history and "started by" services, wired to in-memory stores and to
 * the fixture's own device liveness. Nothing here reads or writes the
 * household's screens.yml / routine history, and the only screen it knows from
 * config is the virtual receiver. The routine catalog is a fixed one-routine
 * list (no Home Assistant config is read) and the history is seeded with one
 * failed and one started run, so the routine views have something true to show.
 */
import express from 'express';
import { createMediaHouseRouter } from '../../backend/src/4_api/v1/routers/mediaHouse.mjs';
import { ScreenRegistryService } from '../../backend/src/3_applications/media/ScreenRegistryService.mjs';
import { RoutineHistoryService } from '../../backend/src/3_applications/media/RoutineHistoryService.mjs';
import { ScreenPlaybackService } from '../../backend/src/3_applications/media/ScreenPlaybackService.mjs';
import { buildRoutineRun } from '../../backend/src/2_domains/media/routineHistory.mjs';

export const HOUSE_FIXTURE_ROUTINE = Object.freeze({
  id: 'automation:acceptance_button', name: 'Acceptance button: Morning', kind: 'automation', source: 'fixture',
});

function memoryStore(initial) {
  let state = structuredClone(initial);
  return {
    load: async () => structuredClone(state),
    save: async (next) => { state = structuredClone(next); },
  };
}

export function createMediaHouseFixture({ deviceId, name, room, deviceLiveness, logger }) {
  const screenId = `fleet:${deviceId}`;
  const routines = [{ ...HOUSE_FIXTURE_ROUTINE, targets: [{ deviceId: screenId, screenId: deviceId, query: 'queue=morning-program' }], via: [] }];
  const summary = ({ id, name: routineName, kind, source }) => ({ id, name: routineName, kind, source });
  const catalog = {
    list: async () => ({ routines, sources: [{ name: 'fixture', kind: 'snapshot', available: true, count: routines.length }] }),
    targeting: async (id) => routines.filter((r) => r.targets.some((t) => t.deviceId === id)).map(summary),
    knows: (id) => routines.some((r) => r.id === id),
    invalidate: () => {},
  };
  const screens = new ScreenRegistryService({
    store: memoryStore({ screens: {}, aliases: {} }),
    configuredScreens: { list: () => [{ id: screenId, screenId: deviceId, name, room, type: 'websocket-screen', wakeable: false }] },
    routines: catalog,
    logger,
  });
  const now = Date.now();
  const seed = [
    buildRoutineRun({ at: new Date(now - 3 * 3600_000).toISOString(), routine: HOUSE_FIXTURE_ROUTINE, deviceId: screenId,
      screenName: name, query: { queue: 'morning-program' }, result: { ok: true, dispatchId: 'seed-started' } }),
    buildRoutineRun({ at: new Date(now - 3600_000).toISOString(), routine: HOUSE_FIXTURE_ROUTINE, deviceId: screenId,
      screenName: name, query: { queue: 'morning-program' }, result: { ok: false, failedStep: 'load', error: 'no subscriber', dispatchId: 'seed-failed' } }),
  ];
  const playLedger = { plays: async () => [] };
  const history = new RoutineHistoryService({ store: memoryStore(seed), catalog, screens, playLedger, logger });
  // "Started by" reads the screen's live session snapshot (meta.origin) first.
  const memory = {
    nowPlaying: async () => {
      const entry = deviceLiveness.getLastSnapshot(deviceId);
      const snap = entry?.online ? entry.snapshot : null;
      const playing = snap && ['playing', 'paused', 'buffering'].includes(snap.state) && snap.currentItem?.contentId;
      return { list: playing ? [{ deviceId: screenId, contentId: snap.currentItem.contentId, title: snap.currentItem.title ?? null }] : [] };
    },
  };
  const playback = new ScreenPlaybackService({ playLedger, livenessService: deviceLiveness, memory, screens, logger });
  const app = express();
  app.use(express.json());
  app.use(createMediaHouseRouter({ screenRegistry: screens, routineCatalog: catalog, routineHistory: history, screenPlayback: playback, logger }));
  const HOUSE_PATH = /^\/api\/v1\/media\/(screens|started-by|routines)(\/|$)/;
  return {
    app,
    handles: (path) => HOUSE_PATH.test(path),
    async serve(req, res) {
      req.url = req.url.replace(/^\/api\/v1\/media/, '') || '/';
      await new Promise((resolve) => {
        res.once('finish', resolve);
        app(req, res, () => { res.statusCode = 404; res.end(); });
      });
    },
  };
}
