import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// ── mocks ────────────────────────────────────────────────────────────────
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy })
}));

let mockCtx;
vi.mock("../../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => mockCtx
}));

// The container reads the official fitness volume store; stub it here (this is a
// lifecycle smoke test, not a volume test — and there's no VolumeProvider).
vi.mock("../../nav/usePersistentVolume.js", () => ({
  usePersistentVolume: () => ({ volume: 1, muted: false, setVolume: vi.fn(), toggleMute: vi.fn() })
}));

import CycleGameContainer from "./CycleGameContainer.jsx";
import { discardRace } from "./raceMenuTestHelpers.js";
import { DEFAULT_WHEEL_CIRCUMFERENCE_M } from "../../lib/cycleGame/distanceModel.js";
import { SessionSerializerV3 } from "../../hooks/fitness/SessionSerializerV3.js";

// "Race my best" is opt-in (2026-11-10): these tests are about the rival, so
// they switch it on first, the way a rider would in the lobby.
const optInRival = (v) => {
  const sw = v.queryByTestId('race-my-best');
  if (sw && sw.getAttribute('aria-checked') !== 'true') act(() => { fireEvent.click(sw); });
};

function makeCtx(overrides = {}) {
  const riders = { cycle_ace: 'user_1', tricycle: 'user_2' };
  const vitals = {
    user_1: { name: 'KC', heartRate: 140, zoneId: 'hot', zoneColor: 'orange' },
    user_2: { name: 'User_2', heartRate: 120, zoneId: 'warm', zoneColor: 'yellow' }
  };
  return {
    equipment: [
      { id: 'cycle_ace', name: 'CycleAce', cadence: 49904, wheel_circumference_m: 2.1, eligible_users: ['user_1'] },
      { id: 'tricycle', name: 'Tricycle', cadence: 7153, wheel_circumference_m: 1.2 }
    ],
    configuredUsers: [
      { id: 'user_1', name: 'KC' },
      { id: 'user_2', name: 'User_2' }
    ],
    zones: [
      { id: 'warm', distance_multiplier: 1.5, color: 'yellow' },
      { id: 'hot', distance_multiplier: 2, color: 'orange' }
    ],
    cycleGameConfig: {
      default_win_condition: 'distance',
      distance_goal_default_m: 3000,
      time_cap_default_s: 300,
      hrless_multiplier: 1.0,
      start_countdown_s: 3,
      staging_buffer_ms: 0, // skip the "to your bikes" buffer in this smoke test
      cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }]
    },
    fitnessSessionInstance: {
      getEquipmentRider: (id) => riders[id] || null,
      getEquipmentCadence: () => ({ rpm: 100, connected: true })
    },
    getUserVitals: (id) => vitals[id] || null,
    getDisplayName: (id) => id,
    getUserByName: (id) => ({ name: vitals[id]?.name || id }),
    setGovernanceSuspended: vi.fn(),
    ...overrides
  };
}

describe('CycleGameContainer (smoke)', () => {
  beforeEach(() => {
    mockCtx = makeCtx();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
    global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
  });

  it('renders the home screen with the race-type dichotomy and a start button', () => {
    const { getByTestId, queryByTestId } = render(<CycleGameContainer />);
    expect(getByTestId('cycle-game-home')).toBeTruthy();
    expect(getByTestId('course-distance')).toBeTruthy();
    expect(getByTestId('course-time')).toBeTruthy();
    expect(getByTestId('cycle-game-start')).toBeTruthy();
    // The race menu must NOT appear on the home/idle screen.
    expect(queryByTestId('race-menu-open')).toBeNull();
    expect(logSpy.info).toHaveBeenCalledWith('cycle_game.home', expect.objectContaining({ riderCount: 2 }));
  });

  it('renders a starting grid slot per bike with the claimed rider', () => {
    const { getByTestId } = render(<CycleGameContainer />);
    expect(getByTestId('bike-cycle_ace')).toBeTruthy();
    expect(getByTestId('bike-tricycle')).toBeTruthy();
  });

  it('moves off the home screen when a race type is selected and Start is clicked', () => {
    const { getByTestId, queryByTestId } = render(<CycleGameContainer />);
    act(() => {
      fireEvent.click(getByTestId('course-distance'));
    });
    act(() => {
      fireEvent.click(getByTestId('cycle-game-start'));
    });
    // staged → countdown phase: home gone, countdown stoplight visible
    expect(queryByTestId('cycle-game-home')).toBeNull();
    expect(getByTestId('countdown-stoplight')).toBeTruthy();
    expect(logSpy.info).toHaveBeenCalledWith(
      'cycle_game.staged',
      expect.objectContaining({ courseId: 'distance', winCondition: 'distance', riders: ['user_1', 'user_2'] })
    );
  });

  it('defaults a bike with no wheel_circumference_m instead of racing it at 0 m per rev', () => {
    // 2026-09-08 race 20260908183719: the Generic Pedaler had no wheel size in
    // config, so a rider spinning 186 rpm scored 0 m for the whole race.
    mockCtx = makeCtx({
      equipment: [
        { id: 'cycle_ace', name: 'CycleAce', cadence: 49904, wheel_circumference_m: 2.1 },
        { id: 'tricycle', name: 'Tricycle', cadence: 7153 } // no wheel size
      ]
    });
    const { getByTestId } = render(<CycleGameContainer />);
    act(() => {
      fireEvent.click(getByTestId('course-distance'));
    });
    act(() => {
      fireEvent.click(getByTestId('cycle-game-start'));
    });
    expect(logSpy.warn).toHaveBeenCalledWith(
      'cycle_game.wheel_default',
      expect.objectContaining({ equipmentId: 'tricycle', userId: 'user_2', wheelCircumferenceM: DEFAULT_WHEEL_CIRCUMFERENCE_M })
    );
    // The effective wheel size is part of the race config telemetry so a 0-m
    // race can be diagnosed from the log store alone.
    expect(logSpy.info).toHaveBeenCalledWith(
      'cycle_game.config',
      expect.objectContaining({
        riders: expect.arrayContaining([
          expect.objectContaining({ userId: 'user_1', equipmentId: 'cycle_ace', wheelCircumferenceM: 2.1 }),
          expect.objectContaining({ userId: 'user_2', equipmentId: 'tricycle', wheelCircumferenceM: DEFAULT_WHEEL_CIRCUMFERENCE_M })
        ])
      })
    );
  });

  it('does not warn about wheel size when every bike is configured', () => {
    const { getByTestId } = render(<CycleGameContainer />);
    act(() => {
      fireEvent.click(getByTestId('course-distance'));
    });
    act(() => {
      fireEvent.click(getByTestId('cycle-game-start'));
    });
    expect(logSpy.warn).not.toHaveBeenCalledWith('cycle_game.wheel_default', expect.anything());
  });
});

describe('CycleGameContainer — governance suspension', () => {
  beforeEach(() => { mockCtx = makeCtx(); });

  it('suspends governance on mount and resumes it on unmount', () => {
    const suspendSpy = vi.fn();
    mockCtx = makeCtx({ setGovernanceSuspended: suspendSpy });

    let view;
    act(() => { view = render(<CycleGameContainer />); });
    expect(suspendSpy).toHaveBeenCalledWith(true);

    act(() => { view.unmount(); });
    expect(suspendSpy).toHaveBeenCalledWith(false);
  });
});

// ── automatic pace rival ─────────────────────────────────────────────────
// A lone rider with no ghost gets a rival: own best at this type + length, else
// the household best, else a constant par pace. The pick runs over the server's
// rival pool (light rows of every race at this type + length, no series) merged
// with the lobby's loaded history; a pick the lobby has not loaded is fetched as
// one record. If the server does not answer in 1500 ms, or that record cannot be
// replayed, the pick is from loaded history alone.
const GOAL_M = 3000; // makeCtx's distance_goal_default_m
const COURSE = { id: 'course-3k', win_condition: 'distance', goal_m: GOAL_M };
const OLD_RACE = '20250505100000'; // older than anything the lobby loads

function raceRecord(id, participants, race = {}) {
  return {
    version: 1,
    race: { id, win_condition: 'distance', goal_m: GOAL_M, interval_seconds: 1, ...race },
    participants: Object.fromEntries(Object.entries(participants).map(([userId, p], i) => [userId, {
      display_name: userId,
      final_distance_m: GOAL_M,
      final_time_s: p.timeS,
      placement: i + 1,
      ...(p.stopped ? { stopped: true } : {}),
      distance_series: p.noSeries ? null : SessionSerializerV3.encodeSeries([GOAL_M / 2, GOAL_M])
    }]))
  };
}

const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const notFound = () => Promise.resolve({ ok: false, status: 404 });
const never = () => new Promise(() => {});
// A response the test settles by hand.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Answers everything the container asks: the lobby's history load (dates, then
// one day's races), the ladder, single-race reads and the rival pool of one race
// type + length.
//   ladder: the /ladder body (default: 404, no featured course)
//   pool:   (url, opts) => Response promise for /rival-pool?winCondition=… (default: no rows)
//   byId:   { raceId: record | (url, opts) => Response promise } for /cycle-races/<raceId>
//   pb:     (url, opts) => Response promise for /personal-bests (default: no best)
// The heavy ?winCondition= listing (full records) answers empty: nothing should ask.
function historyFetch(races, { ladder = null, pool = null, byId = {}, pb = null } = {}) {
  return vi.fn((url, opts) => {
    const u = String(url);
    if (u.includes('/personal-bests')) return pb ? pb(u, opts) : json({ best: null });
    if (u.includes('/ladder')) return ladder ? json(ladder) : notFound();
    if (u.includes('/rival-pool')) return pool ? pool(u, opts) : json({ entries: [] });
    if (u.includes('winCondition=')) return json({ races: [] });
    if (u.includes('?date=')) return json({ races });
    const one = u.match(/\/cycle-races\/(\d+)$/);
    if (one) {
      const hit = byId[one[1]];
      if (typeof hit === 'function') return hit(u, opts);
      return hit ? json({ race: hit }) : notFound();
    }
    return json({ dates: ['2026-01-01'] });
  });
}

function soloCtx(riders = { cycle_ace: 'user_1' }, cycleGameConfig = {}) {
  const base = makeCtx();
  return {
    ...base,
    cycleGameConfig: { ...base.cycleGameConfig, ...cycleGameConfig },
    fitnessSessionInstance: { ...base.fitnessSessionInstance, getEquipmentRider: (id) => riders[id] || null }
  };
}

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderLobby(races, fetchOpts) {
  global.fetch = historyFetch(races, fetchOpts);
  const view = render(<CycleGameContainer />);
  await flush(3);
  expect(logSpy.info).toHaveBeenCalledWith('cycle_game.history_loaded', expect.objectContaining({ races: races.length }));
  return view;
}

// Click a race type, press Start, and let the rival lookup settle.
async function startRaceOf(view, type = 'distance') {
  act(() => { fireEvent.click(view.getByTestId(`course-${type}`)); });
  optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
  await flush();
}

const logsOf = (level, event) => logSpy[level].mock.calls.filter(([e]) => e === event).map(([, d]) => d);
const configLogs = () => logsOf('info', 'cycle_game.config');
const paceRivalLogs = () => logsOf('info', 'cycle_game.pace_rival');
const ignoredLogs = () => logsOf('info', 'cycle_game.start_ignored');
const featuredFailLogs = () => logsOf('warn', 'cycle_game.featured_rival_lookup_failed');
const rideFeaturedLogs = () => logsOf('info', 'cycle_game.ride_featured');
const stagedLogs = () => logsOf('info', 'cycle_game.staged');
const isFrozen = (view) => view.getByTestId('cycle-game-home').getAttribute('aria-busy') === 'true';
const ghostIds = (cfg) => cfg.riders.filter((r) => r.isGhost).map((r) => r.userId);
const callsTo = (test) => global.fetch.mock.calls.filter(([u]) => test(String(u)));
const poolCalls = () => callsTo((u) => u.includes('/cycle-races/rival-pool?'));
const recordCalls = () => callsTo((u) => /\/cycle-races\/\d+$/.test(u));
// The heavy listing of full records at one type + length: the rival never uses it.
const heavyListCalls = () => callsTo((u) => u.includes('/cycle-races?winCondition='));
// A saved record as the server's rival-pool entry (an index row: results, no series).
function poolEntry(rec) {
  const { race } = rec;
  return {
    raceId: race.id,
    date: `${race.id.slice(0, 4)}-${race.id.slice(4, 6)}-${race.id.slice(6, 8)}`,
    winCondition: race.win_condition,
    ...(race.win_condition === 'time' ? { timeCapS: race.time_cap_s } : { goalM: race.goal_m }),
    participants: Object.entries(rec.participants).map(([id, pt]) => ({
      id, isGhost: id.startsWith('ghost:'), stopped: !!pt.stopped,
      finalTimeS: pt.final_time_s ?? null, finalDistanceM: pt.final_distance_m, placement: pt.placement
    }))
  };
}
// The pool the server would answer for these saved records: ended-early races left out.
const poolOf = (...records) => () => json({ entries: records.filter((r) => !r.race.incomplete).map(poolEntry) });
// The record reads (/cycle-races/<raceId>) the server would answer for these records.
const recordsById = (...records) => Object.fromEntries(records.map((r) => [r.race.id, r]));

// Owner, garage 2026-11-11: "Ride it" on THIS WEEK'S COURSE (Sprint 1500, a
// child #1) with two riders raced only each other — the leader's ghost had been
// put behind "Race my best" (eff1b72b0d). The weekly course always races the
// leader's ghost; the switch only governs the automatic pace rival.
describe('CycleGameContainer — "Ride it" always races the weekly-course ghost', () => {
  const LEAD_RACE = '20261110081048';
  const OTHER_RACE = '20261110122811';
  // The leader's best run also carried a ghost they raced: only the leader replays.
  const leadRecord = raceRecord(LEAD_RACE, { user_3: { timeS: 250 }, 'ghost:20261109181504:user_4': { timeS: 260 } });
  const otherRecord = raceRecord(OTHER_RACE, { user_4: { timeS: 270 } });
  const byId = recordsById(leadRecord, otherRecord);
  const twoRiders = () => soloCtx({ cycle_ace: 'user_1', tricycle: 'user_2' });

  beforeEach(() => {
    mockCtx = twoRiders();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
  });

  it("two riders, switch off: the week's leader races as a ghost, alone from their record", async () => {
    const ladder = { course: COURSE, standings: [{ userId: 'user_3', raceId: LEAD_RACE, bestValue: 250 }] };
    const view = await renderLobby([], { ladder, byId });
    act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
    await flush();
    const [cfg] = configLogs();
    expect(cfg).toMatchObject({ winCondition: 'distance', goalM: GOAL_M });
    expect(cfg.riders.map((r) => r.userId)).toEqual(['user_1', 'user_2', `ghost:${LEAD_RACE}:user_3`]);
    expect(rideFeaturedLogs()).toEqual([expect.objectContaining({
      courseId: COURSE.id, rivalKind: 'leader', rivalUserId: 'user_3', rivalRaceId: LEAD_RACE, ghostArmed: true, raceMyBest: false
    })]);
    expect(poolCalls()).toEqual([]);
    expect(view.getByTestId(`ready-rider-ghost:${LEAD_RACE}:user_3`)).toBeTruthy();
  });

  it('the leader on a bike: the best run by anyone not riding', async () => {
    const ladder = { course: COURSE, standings: [
      { userId: 'user_1', raceId: '20261109090000', bestValue: 240 },
      { userId: 'user_4', raceId: OTHER_RACE, bestValue: 270 }
    ] };
    const view = await renderLobby([], { ladder, byId });
    act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
    await flush();
    expect(ghostIds(configLogs()[0])).toEqual([`ghost:${OTHER_RACE}:user_4`]);
    expect(rideFeaturedLogs()[0]).toMatchObject({ rivalKind: 'best-not-riding', rivalUserId: 'user_4' });
  });

  it("everyone on the ladder is riding: the leader's own record as the ghost", async () => {
    const own = raceRecord(LEAD_RACE, { user_1: { timeS: 240 } });
    const ladder = { course: COURSE, standings: [{ userId: 'user_1', raceId: LEAD_RACE, bestValue: 240 }] };
    const view = await renderLobby([], { ladder, byId: recordsById(own) });
    act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
    await flush();
    expect(ghostIds(configLogs()[0])).toEqual([`ghost:${LEAD_RACE}:user_1`]);
    expect(rideFeaturedLogs()[0]).toMatchObject({ rivalKind: 'leader-own-record', rivalUserId: 'user_1' });
  });

  it('no runs this week: no ghost, nothing fetched, and the card says so', async () => {
    const ladder = { course: COURSE, standings: [] };
    const view = await renderLobby([], { ladder, byId });
    expect(view.getByTestId('featured-course-card').textContent).toMatch(/no ghost/i);
    act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
    await flush();
    expect(ghostIds(configLogs()[0])).toEqual([]);
    expect(recordCalls()).toEqual([]);
    expect(rideFeaturedLogs()[0]).toMatchObject({ rivalKind: 'none', ghostArmed: false });
  });

  it("switch off and the leader's record cannot be had: the riders race, with no automatic rival", async () => {
    mockCtx = soloCtx();
    const ladder = { course: COURSE, standings: [{ userId: 'user_3', raceId: LEAD_RACE, bestValue: 250 }] };
    const view = await renderLobby([raceRecord('20260101110000', { user_1: { timeS: 300 } })], { ladder, byId: {} });
    act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
    await flush();
    expect(featuredFailLogs()).toEqual([expect.objectContaining({ stage: 'record', reason: 'error' })]);
    expect(ghostIds(configLogs()[0])).toEqual([]);
    expect(paceRivalLogs()).toEqual([]);
  });
});

describe('CycleGameContainer — a rival is opt-in ("Race my best", off by default)', () => {
  beforeEach(() => {
    mockCtx = soloCtx();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
  });

  it('a lone rider on a plain Distance race gets no rival: no lookup, no pace_rival event', async () => {
    const view = await renderLobby([raceRecord('20260101110000', { user_1: { timeS: 300 } })]);
    expect(view.getByTestId('race-my-best').getAttribute('aria-checked')).toBe('false');
    act(() => { fireEvent.click(view.getByTestId('course-distance')); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    await flush();
    const [cfg] = configLogs();
    expect(cfg.rivalKind).toBeNull();
    expect(ghostIds(cfg)).toEqual([]);
    expect(paceRivalLogs()).toEqual([]);
    expect(poolCalls()).toEqual([]);
    expect(logSpy.debug).toHaveBeenCalledWith('cycle_game.pace_rival_skipped', expect.objectContaining({ reason: 'not_opted_in' }));
  });

  it('switching it on and off again before Start removes the rival', async () => {
    const view = await renderLobby([raceRecord('20260101110000', { user_1: { timeS: 300 } })]);
    act(() => { fireEvent.click(view.getByTestId('race-my-best')); });
    expect(view.getByTestId('race-my-best').getAttribute('aria-checked')).toBe('true');
    act(() => { fireEvent.click(view.getByTestId('race-my-best')); });
    expect(view.getByTestId('race-my-best').getAttribute('aria-checked')).toBe('false');
    expect(logsOf('info', 'cycle_game.race_my_best_set')).toEqual([
      { on: true, control: 'lobby.race-my-best' }, { on: false, control: 'lobby.race-my-best' }
    ]);
    act(() => { fireEvent.click(view.getByTestId('course-distance')); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    await flush();
    expect(configLogs()[0].rivalKind).toBeNull();
    expect(paceRivalLogs()).toEqual([]);
  });

  it('switched on, the lone rider races their own best', async () => {
    const view = await renderLobby([raceRecord('20260101110000', { user_1: { timeS: 300 } })]);
    act(() => { fireEvent.click(view.getByTestId('race-my-best')); });
    act(() => { fireEvent.click(view.getByTestId('course-distance')); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    await flush();
    expect(configLogs()[0].rivalKind).toBe('self');
    expect(paceRivalLogs()).toHaveLength(1);
  });

});

describe('CycleGameContainer — automatic pace rival', () => {
  beforeEach(() => {
    mockCtx = soloCtx();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
  });

  describe('picking from the loaded history (the server pool adds nothing)', () => {
    it("a lone rider with no ghost races their own best at this type and length", async () => {
      const view = await renderLobby([
        raceRecord('20260101100000', { user_1: { timeS: 400 } }),
        raceRecord('20260101110000', { user_1: { timeS: 300 }, user_2: { timeS: 200 } }),
        raceRecord('20260101120000', { user_1: { timeS: 100 } }, { goal_m: 1000 }) // other length: ignored
      ]);
      await startRaceOf(view);
      const [cfg] = configLogs();
      expect(ghostIds(cfg)).toEqual(['ghost:20260101110000:user_1']);
      expect(cfg.rivalKind).toBe('self');
      expect(paceRivalLogs()).toEqual([{
        raceId: cfg.raceId, kind: 'self', requestedKind: 'self',
        sourceRaceId: '20260101110000', participantId: 'user_1',
        source: 'server-history', candidates: 2, historyLoaded: true, serverLookup: 'used',
        lookupMs: expect.any(Number), recordFetched: false
      }]);
      // One request, for exactly this race type and length: the light pool, never
      // the heavy listing, and no record (the pick is already loaded).
      expect(poolCalls()).toHaveLength(1);
      expect(String(poolCalls()[0][0])).toBe(`/api/v1/fitness/cycle-races/rival-pool?winCondition=distance&goalM=${GOAL_M}`);
      expect(heavyListCalls()).toEqual([]);
      expect(recordCalls()).toEqual([]);
    });

    it('falls to the household best when the rider has no ride of their own', async () => {
      const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })]);
      await startRaceOf(view);
      const [cfg] = configLogs();
      expect(ghostIds(cfg)).toEqual(['ghost:20260101100000:user_2']);
      expect(cfg.rivalKind).toBe('household');
      expect(paceRivalLogs()).toEqual([expect.objectContaining({
        kind: 'household', sourceRaceId: '20260101100000', participantId: 'user_2', candidates: 1
      })]);
    });

    it('falls to a par pace when nobody has ridden this race', async () => {
      const view = await renderLobby([]);
      await startRaceOf(view);
      const [cfg] = configLogs();
      expect(ghostIds(cfg)).toEqual(['ghost:par:par']);
      expect(cfg.rivalKind).toBe('par');
      expect(paceRivalLogs()).toEqual([{
        raceId: cfg.raceId, kind: 'par', requestedKind: 'par', sourceRaceId: null, participantId: 'par',
        source: 'par', candidates: 0, historyLoaded: true, serverLookup: 'used',
        lookupMs: expect.any(Number), recordFetched: false
      }]);
    });

    it('falls back to par when the picked ride has nothing to replay', async () => {
      const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300, noSeries: true } })]);
      await startRaceOf(view);
      const [cfg] = configLogs();
      expect(ghostIds(cfg)).toEqual(['ghost:par:par']);
      expect(cfg.rivalKind).toBe('par');
      expect(paceRivalLogs()).toEqual([expect.objectContaining({ kind: 'par', requestedKind: 'self', sourceRaceId: null, source: 'par' })]);
    });

    it("reports kind 'none' and starts without a rival when even par cannot be built", async () => {
      // A 5-hour time race is past par's four-hour sample cap.
      mockCtx = soloCtx({ cycle_ace: 'user_1' }, { time_cap_default_s: 18000 });
      const view = await renderLobby([]);
      await startRaceOf(view, 'time');
      const [cfg] = configLogs();
      expect(cfg.timeCapS).toBe(18000);
      expect(cfg.riders.map((r) => r.userId)).toEqual(['user_1']);
      expect(cfg.rivalKind).toBeNull();
      expect(paceRivalLogs()).toEqual([expect.objectContaining({
        kind: 'none', requestedKind: 'par', sourceRaceId: null, participantId: null
      })]);
      expect(String(poolCalls()[0][0])).toContain('/rival-pool?winCondition=time&timeCapS=18000');
    });
  });

  it('two claimed riders race each other at once: no rival, no lookup, no pace_rival event', async () => {
    mockCtx = soloCtx({ cycle_ace: 'user_1', tricycle: 'user_2' });
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300 } })]);
    act(() => { fireEvent.click(view.getByTestId('course-distance')); });
    optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const [cfg] = configLogs(); // synchronous: nothing to wait for
    expect(ghostIds(cfg)).toEqual([]);
    expect(cfg.rivalKind).toBeNull();
    expect(paceRivalLogs()).toEqual([]);
    expect(poolCalls()).toEqual([]);
  });

  it('a hand-picked ghost races alone at once: no automatic rival is added', async () => {
    const view = await renderLobby([
      raceRecord('20260101100000', { user_2: { timeS: 400 } }),
      raceRecord('20260101110000', { user_1: { timeS: 300 } }) // would be the automatic pick
    ]);
    act(() => { fireEvent.click(view.getByTestId('course-ghost')); });
    act(() => { fireEvent.click(view.getByTestId('ghost-20260101100000')); }); // focus
    act(() => { fireEvent.click(view.getByTestId('ghost-20260101100000')); }); // commit
    expect(view.getByTestId('cgh-ghost-summary')).toBeTruthy();
    optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const [cfg] = configLogs();
    expect(ghostIds(cfg)).toEqual(['ghost:20260101100000:user_2']);
    expect(cfg.rivalKind).toBe('ghost');
    expect(paceRivalLogs()).toEqual([]);
    expect(poolCalls()).toEqual([]);
  });

  describe('searching the full history on the server', () => {
    it("finds the rider's best when it is older than the loaded history, and fetches that one record", async () => {
      const old = raceRecord(OLD_RACE, { user_2: { timeS: 200 }, user_1: { timeS: 240 } });
      const other = raceRecord('20250404100000', { user_1: { timeS: 260 } });
      const view = await renderLobby([raceRecord('20260101110000', { user_1: { timeS: 300 } })],
        { pool: poolOf(old, other), byId: recordsById(old, other) });
      act(() => { fireEvent.click(view.getByTestId('course-distance')); });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
      expect(configLogs()).toEqual([]); // waiting on the server
      await flush();
      const [cfg] = configLogs();
      expect(ghostIds(cfg)).toEqual([`ghost:${OLD_RACE}:user_1`]); // the rider only, not that race's winner
      expect(cfg.rivalKind).toBe('self');
      expect(paceRivalLogs()).toEqual([{
        raceId: cfg.raceId, kind: 'self', requestedKind: 'self', sourceRaceId: OLD_RACE, participantId: 'user_1',
        source: 'server-history', candidates: 3, historyLoaded: true, serverLookup: 'used',
        lookupMs: expect.any(Number), recordFetched: true
      }]);
      expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
      // The picked race's record, and no other; the heavy listing is not used.
      expect(recordCalls().map(([u]) => String(u))).toEqual([`/api/v1/fitness/cycle-races/${OLD_RACE}`]);
      expect(heavyListCalls()).toEqual([]);
      // Both requests can be aborted by the one start.
      expect(recordCalls()[0][1].signal).toBe(poolCalls()[0][1].signal);
    });

    it('finds the household best there when the rider has never ridden this race', async () => {
      const old = raceRecord(OLD_RACE, { user_2: { timeS: 200 } });
      const view = await renderLobby([], { pool: poolOf(old), byId: recordsById(old) });
      await startRaceOf(view);
      expect(ghostIds(configLogs()[0])).toEqual([`ghost:${OLD_RACE}:user_2`]);
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'household', source: 'server-history', candidates: 1, serverLookup: 'used', recordFetched: true });
    });

    it('a race in both lists is considered once, and replayed from the loaded copy: no record is fetched', async () => {
      const shared = raceRecord('20260101110000', { user_1: { timeS: 300 } });
      const slower = raceRecord(OLD_RACE, { user_1: { timeS: 340 } });
      const view = await renderLobby([shared], { pool: poolOf(shared, slower), byId: recordsById(shared, slower) });
      await startRaceOf(view);
      expect(ghostIds(configLogs()[0])).toEqual(['ghost:20260101110000:user_1']);
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'self', sourceRaceId: '20260101110000', candidates: 2, serverLookup: 'used', recordFetched: false });
      expect(recordCalls()).toEqual([]);
    });

    it("never picks the rider's ride from a race ended early, or one they were stopped in", async () => {
      const endedEarly = raceRecord('20250101100000', { user_1: { timeS: 100 } }, { incomplete: true });
      const stopped = raceRecord('20250102100000', { user_1: { timeS: 120, stopped: true } });
      const honest = raceRecord('20250103100000', { user_1: { timeS: 280 } });
      // The ended-early race is known to the lobby; the server's pool leaves it out.
      const view = await renderLobby([endedEarly], { pool: poolOf(endedEarly, stopped, honest), byId: recordsById(endedEarly, stopped, honest) });
      await startRaceOf(view);
      expect(ghostIds(configLogs()[0])).toEqual(['ghost:20250103100000:user_1']);
      // The ended-early race is out of the pool; the stopped ride is in a counted race.
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'self', sourceRaceId: '20250103100000', candidates: 2 });
      expect(recordCalls().map(([u]) => String(u))).toEqual(['/api/v1/fitness/cycle-races/20250103100000']);
    });

    it('falls back to loaded history when the request fails', async () => {
      const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })],
        { pool: () => Promise.reject(new Error('offline')) });
      await startRaceOf(view);
      expect(ghostIds(configLogs()[0])).toEqual(['ghost:20260101100000:user_2']);
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'household', source: 'history', candidates: 1, serverLookup: 'error', recordFetched: false });
      expect(logSpy.warn).toHaveBeenCalledWith('cycle_game.pace_rival_lookup_failed', expect.objectContaining({ outcome: 'error', stage: 'pool', error: 'offline' }));
    });

    it.each([400, 500, 503])('falls back to loaded history when the pool answers HTTP %i', async (status) => {
      const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })],
        { pool: () => Promise.resolve({ ok: false, status }) });
      await startRaceOf(view);
      expect(ghostIds(configLogs()[0])).toEqual(['ghost:20260101100000:user_2']);
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'household', source: 'history', candidates: 1, serverLookup: 'error', recordFetched: false });
      expect(logSpy.warn).toHaveBeenCalledWith('cycle_game.pace_rival_lookup_failed',
        expect.objectContaining({ outcome: 'error', stage: 'pool', error: `rival-pool ${status}` }));
      expect(recordCalls()).toEqual([]);
    });

    it('falls to par on a pool HTTP error when the lobby has nothing either', async () => {
      const view = await renderLobby([], { pool: () => Promise.resolve({ ok: false, status: 503 }) });
      await startRaceOf(view);
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'par', source: 'par', serverLookup: 'error' });
    });

    it('treats a pool answer with no entries list as an empty pool', async () => {
      const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })], { pool: () => json({}) });
      await startRaceOf(view);
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'household', candidates: 1, serverLookup: 'used', recordFetched: false });
    });

    describe('when the picked record cannot be had', () => {
      const old = raceRecord(OLD_RACE, { user_1: { timeS: 240 } });
      const loaded = raceRecord('20260101110000', { user_1: { timeS: 300 } });
      const failures = {
        'is missing (404)': { byId: {}, error: `cycle-races/${OLD_RACE} 404` },
        'request fails': { byId: { [OLD_RACE]: () => Promise.reject(new Error('offline')) }, error: 'offline' },
        'has no series to replay for that rider': {
          byId: recordsById(raceRecord(OLD_RACE, { user_1: { timeS: 240, noSeries: true } })), error: 'record not replayable'
        },
        'does not hold that rider': { byId: recordsById(raceRecord(OLD_RACE, { user_2: { timeS: 240 } })), error: 'record not replayable' },
        'is not a record': { byId: { [OLD_RACE]: () => json({}) }, error: 'record not replayable' }
      };

      it.each(Object.keys(failures))("falls back to the rider's best in loaded history when the record %s", async (name) => {
        const { byId, error } = failures[name];
        const view = await renderLobby([loaded], { pool: poolOf(old, loaded), byId });
        await startRaceOf(view);
        const [cfg] = configLogs();
        expect(ghostIds(cfg)).toEqual(['ghost:20260101110000:user_1']);
        expect(cfg.rivalKind).toBe('self');
        expect(paceRivalLogs()).toEqual([{
          raceId: cfg.raceId, kind: 'self', requestedKind: 'self', sourceRaceId: '20260101110000', participantId: 'user_1',
          source: 'history', candidates: 1, historyLoaded: true, serverLookup: 'error',
          lookupMs: expect.any(Number), recordFetched: true
        }]);
        expect(logSpy.warn).toHaveBeenCalledWith('cycle_game.pace_rival_lookup_failed',
          expect.objectContaining({ outcome: 'error', stage: 'record', sourceRaceId: OLD_RACE, error }));
        expect(recordCalls()).toHaveLength(1);
        expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
      });

      it('falls to par when loaded history has no ride either', async () => {
        const view = await renderLobby([], { pool: poolOf(old), byId: {} });
        await startRaceOf(view);
        const [cfg] = configLogs();
        expect(ghostIds(cfg)).toEqual(['ghost:par:par']);
        expect(paceRivalLogs()[0]).toMatchObject({
          kind: 'par', requestedKind: 'par', source: 'par', candidates: 0, serverLookup: 'error', recordFetched: true
        });
      });
    });

    describe('with a server that is slow or silent', () => {
      beforeEach(() => { vi.useFakeTimers(); });
      afterEach(() => { vi.useRealTimers(); });

      it('waits 1500 ms, then starts with the local pick; a late answer changes nothing', async () => {
        const late = deferred();
        const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })],
          { pool: () => late.promise });
        act(() => { fireEvent.click(view.getByTestId('course-distance')); });
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
        await act(async () => { vi.advanceTimersByTime(1499); });
        expect(configLogs()).toEqual([]);
        expect(view.getByTestId('cycle-game-home')).toBeTruthy();
        await act(async () => { vi.advanceTimersByTime(1); });
        await flush();
        expect(ghostIds(configLogs()[0])).toEqual(['ghost:20260101100000:user_2']);
        expect(paceRivalLogs()[0]).toMatchObject({
          kind: 'household', source: 'history', serverLookup: 'timeout', lookupMs: 1500, recordFetched: false
        });
        expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
        // The request was aborted at the deadline …
        expect(poolCalls()[0][1].signal.aborted).toBe(true);
        // … and if its answer arrives anyway, the running race is untouched.
        const infoBefore = logSpy.info.mock.calls.length;
        late.resolve({ ok: true, json: () => Promise.resolve({ entries: [poolEntry(raceRecord(OLD_RACE, { user_1: { timeS: 100 } }))] }) });
        await flush();
        expect(recordCalls()).toEqual([]); // no record is fetched for a start that has gone
        expect(configLogs()).toHaveLength(1);
        expect(paceRivalLogs()).toHaveLength(1);
        expect(logSpy.info.mock.calls.length).toBe(infoBefore);
        expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
        expect(view.getByTestId('ready-rider-ghost:20260101100000:user_2')).toBeTruthy();
      });

      it('the record fetch shares the 1500 ms: a record that never arrives is aborted and the local pick races', async () => {
        const old = raceRecord(OLD_RACE, { user_1: { timeS: 240 } });
        const lateRecord = deferred();
        const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })],
          { pool: poolOf(old), byId: { [OLD_RACE]: () => lateRecord.promise } });
        act(() => { fireEvent.click(view.getByTestId('course-distance')); });
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
        await flush(); // the pool has answered; the record is being fetched
        expect(recordCalls()).toHaveLength(1);
        await act(async () => { vi.advanceTimersByTime(1499); });
        await flush();
        expect(configLogs()).toEqual([]);
        await act(async () => { vi.advanceTimersByTime(1); });
        await flush();
        expect(ghostIds(configLogs()[0])).toEqual(['ghost:20260101100000:user_2']);
        expect(paceRivalLogs()[0]).toMatchObject({
          kind: 'household', source: 'history', candidates: 1, serverLookup: 'timeout', lookupMs: 1500, recordFetched: true
        });
        expect(recordCalls()[0][1].signal.aborted).toBe(true);
        // A late record changes nothing.
        lateRecord.resolve({ ok: true, json: () => Promise.resolve({ race: old }) });
        await flush();
        expect(configLogs()).toHaveLength(1);
        expect(paceRivalLogs()).toHaveLength(1);
        expect(view.getByTestId('ready-rider-ghost:20260101100000:user_2')).toBeTruthy();
      });

      it('says so when Start is pressed before the lobby history has loaded', async () => {
        global.fetch = vi.fn(never); // nothing ever answers
        const view = render(<CycleGameContainer />);
        act(() => { fireEvent.click(view.getByTestId('course-distance')); });
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
        await act(async () => { vi.advanceTimersByTime(1500); });
        await flush();
        expect(paceRivalLogs()).toEqual([expect.objectContaining({
          kind: 'par', candidates: 0, historyLoaded: false, serverLookup: 'timeout'
        })]);
      });

      it('freezes the lobby and says "Starting…" while it waits; a second Start press is dropped', async () => {
        const view = await renderLobby([], { pool: never });
        act(() => { fireEvent.click(view.getByTestId('course-distance')); });
        expect(view.getByTestId('cycle-game-home').getAttribute('aria-busy')).toBe('false');
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
        const start = view.getByTestId('cycle-game-start');
        expect(view.getByTestId('cycle-game-home').getAttribute('aria-busy')).toBe('true');
        expect(start.textContent).toContain('Starting…');
        expect(start.disabled).toBe(true);
        act(() => { fireEvent.click(start); });
        act(() => { fireEvent.click(start); });
        await act(async () => { vi.advanceTimersByTime(1500); });
        await flush();
        expect(configLogs()).toHaveLength(1);
        expect(paceRivalLogs()).toHaveLength(1);
        expect(logsOf('info', 'cycle_game.start_pressed')).toHaveLength(1);
      });

      it('a race-type change attempted while it waits neither alters the race nor sticks to the lobby', async () => {
        const view = await renderLobby([], { pool: never });
        act(() => { fireEvent.click(view.getByTestId('course-distance')); });
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
        act(() => { fireEvent.click(view.getByTestId('course-time')); });
        act(() => { fireEvent.click(view.getByTestId('tier-flash')); });
        await act(async () => { vi.advanceTimersByTime(1500); });
        await flush();
        expect(configLogs()).toHaveLength(1);
        expect(configLogs()[0]).toMatchObject({ winCondition: 'distance', goalM: GOAL_M });
        expect(logsOf('info', 'cycle_game.race_type_selected')).toHaveLength(1);
        expect(logsOf('info', 'cycle_game.race_value_set')).toEqual([]);
        discardRace(view);
        await flush(3);
        // Back in the lobby: unfrozen, and still set to the distance race.
        expect(view.getByTestId('cycle-game-home').getAttribute('aria-busy')).toBe('false');
        expect(view.getByTestId('cycle-game-start').textContent).toContain('Start race');
        expect(view.getByTestId('course-distance').getAttribute('aria-pressed')).toBe('true');
        expect(view.getByTestId('course-time').getAttribute('aria-pressed')).toBe('false');
      });

      it('aborts the lookup and starts nothing if the game is closed first', async () => {
        const view = await renderLobby([], { pool: never });
        act(() => { fireEvent.click(view.getByTestId('course-distance')); });
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
        const { signal } = poolCalls()[0][1];
        expect(signal.aborted).toBe(false);
        act(() => { view.unmount(); });
        expect(signal.aborted).toBe(true);
        await act(async () => { vi.advanceTimersByTime(1500); });
        await flush();
        expect(configLogs()).toEqual([]);
        expect(paceRivalLogs()).toEqual([]);
      });

      it('never leaves an unhandled rejection if launching throws: logs start_failed and unfreezes', async () => {
        // Make the launch itself throw, after the lookup has answered.
        const view = await renderLobby([], { pool: () => json({ entries: [] }) });
        act(() => { fireEvent.click(view.getByTestId('course-distance')); });
        const boom = new Error('boom');
        logSpy.info.mockImplementation((event) => { if (event === 'cycle_game.config') throw boom; });
        try {
          optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
          await flush();
        } finally {
          logSpy.info.mockImplementation(() => {});
        }
        expect(logSpy.error).toHaveBeenCalledWith('cycle_game.start_failed', expect.objectContaining({ error: 'boom' }));
        expect(view.getByTestId('cycle-game-home').getAttribute('aria-busy')).toBe('false');
      });
    });
  });

  describe('featured-course ride (ladder rival passed as the ghost override)', () => {
    const RIVAL_RACE = '20251201100000';
    const ladder = { course: COURSE, standings: [{ userId: 'user_2', raceId: RIVAL_RACE, bestValue: 250 }] };
    const rivalRecord = raceRecord(RIVAL_RACE, { user_2: { timeS: 250 } });
    const byId = { [RIVAL_RACE]: rivalRecord };

    it("a ladder rival is the rider's rival: rivalKind 'ghost', no automatic rival", async () => {
      const view = await renderLobby([raceRecord('20260101110000', { user_1: { timeS: 300 } })], { ladder, byId });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
      await flush();
      const [cfg] = configLogs();
      expect(cfg.riders.map((r) => r.userId)).toEqual(['user_1', `ghost:${RIVAL_RACE}:user_2`]);
      expect(cfg.rivalKind).toBe('ghost');
      expect(paceRivalLogs()).toEqual([]);
      expect(poolCalls()).toEqual([]);
    });

    it('with no bike claimed it still starts, as a ghost-only race', async () => {
      mockCtx = soloCtx({});
      const view = await renderLobby([], { ladder, byId });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
      await flush();
      expect(logSpy.warn).not.toHaveBeenCalledWith('cycle_game.staged', expect.objectContaining({ error: 'no_riders' }));
      const [cfg] = configLogs();
      expect(cfg.riders.map((r) => r.userId)).toEqual([`ghost:${RIVAL_RACE}:user_2`]);
      expect(cfg.rivalKind).toBe('ghost');
      expect(paceRivalLogs()).toEqual([]);
      expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
    });

    it('freezes the lobby while it fetches its rival; a Start in that time is ignored and the featured ride races', async () => {
      const slow = deferred();
      const view = await renderLobby([], { ladder, byId: { [RIVAL_RACE]: () => slow.promise } });
      act(() => { fireEvent.click(view.getByTestId('course-time')); });
      expect(isFrozen(view)).toBe(false);
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); }); // waiting on the rival's record
      // Frozen at once, before anything has answered.
      expect(isFrozen(view)).toBe(true);
      expect(view.getByTestId('cycle-game-start').textContent).toContain('Starting…');
      expect(view.getByTestId('cycle-game-start').disabled).toBe(true);
      expect(view.getByTestId('featured-ride').disabled).toBe(true);
      await flush(2);
      // The Start button is dead, and a start from any other control is refused.
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
      let accepted;
      act(() => { accepted = window.__cycleGameControl.startRace({ winCondition: 'time', value: 60 }); });
      expect(accepted).toBe(false);
      expect(ignoredLogs()).toEqual([{ reason: 'start_pending', control: 'sim.autostart' }]);
      expect(configLogs()).toEqual([]);
      slow.resolve({ ok: true, json: () => Promise.resolve({ race: rivalRecord }) });
      await flush();
      // The one race is the featured course with its ladder rival.
      expect(configLogs()).toHaveLength(1);
      expect(configLogs()[0]).toMatchObject({ winCondition: 'distance', goalM: GOAL_M, rivalKind: 'ghost' });
      expect(configLogs()[0].riders.map((r) => r.userId)).toEqual(['user_1', `ghost:${RIVAL_RACE}:user_2`]);
      expect(rideFeaturedLogs()).toEqual([expect.objectContaining({ courseId: COURSE.id, ghostArmed: true })]);
      expect(featuredFailLogs()).toEqual([]);
      // Back in the lobby it is live again.
      discardRace(view);
      await flush(3);
      expect(isFrozen(view)).toBe(false);
      expect(view.getByTestId('cycle-game-start').textContent).toContain('Start race');
    });

    it('a second "Ride it" tap in the same tick is ignored: one fetch, one race', async () => {
      const view = await renderLobby([], { ladder, byId });
      optInRival(view);
      act(() => {
        fireEvent.click(view.getByTestId('featured-ride'));
        fireEvent.click(view.getByTestId('featured-ride'));
      });
      await flush();
      expect(ignoredLogs()).toEqual([{ reason: 'start_pending', control: 'featured' }]);
      expect(recordCalls()).toHaveLength(1);
      expect(configLogs()).toHaveLength(1);
      expect(rideFeaturedLogs()).toHaveLength(1);
    });

    it('"Ride it" in the same tick as a Start that already launched is ignored', async () => {
      mockCtx = soloCtx({ cycle_ace: 'user_1', tricycle: 'user_2' });
      const view = await renderLobby([], { ladder, byId });
      act(() => { fireEvent.click(view.getByTestId('course-time')); });
      act(() => {
        fireEvent.click(view.getByTestId('cycle-game-start')); // two riders: launches at once
        fireEvent.click(view.getByTestId('featured-ride'));
      });
      await flush();
      expect(ignoredLogs()).toEqual([{ reason: 'not_idle', control: 'featured' }]);
      expect(recordCalls()).toEqual([]);
      expect(configLogs()).toHaveLength(1);
      expect(configLogs()[0]).toMatchObject({ winCondition: 'time', rivalKind: null });
      expect(rideFeaturedLogs()).toEqual([]);
    });

    it('"Ride it" in the same tick as a Start that is waiting on its lookup is ignored', async () => {
      const view = await renderLobby([], { ladder, byId, pool: never });
      act(() => { fireEvent.click(view.getByTestId('course-time')); });
      optInRival(view);
      act(() => {
        fireEvent.click(view.getByTestId('cycle-game-start')); // one rider: waits on the rival pool
        fireEvent.click(view.getByTestId('featured-ride'));
      });
      await flush();
      expect(ignoredLogs()).toEqual([{ reason: 'start_pending', control: 'featured' }]);
      expect(recordCalls()).toEqual([]);
      expect(rideFeaturedLogs()).toEqual([]);
    });

    it('a featured start that is dropped (nobody to race) writes nothing: no ride_featured, no ghost lock, lobby live', async () => {
      mockCtx = soloCtx({}); // nobody on a bike, and the ladder rival's record is gone
      const view = await renderLobby([], { ladder, byId: {} });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
      await flush();
      expect(logSpy.warn).toHaveBeenCalledWith('cycle_game.staged', expect.objectContaining({ error: 'no_riders' }));
      expect(configLogs()).toEqual([]);
      expect(rideFeaturedLogs()).toEqual([]);
      expect(view.queryByTestId('cgh-ghost-summary')).toBeNull();
      expect(isFrozen(view)).toBe(false);
      expect(view.getByTestId('featured-ride').disabled).toBe(false);
    });

    it('starts at once without the ladder rival when its record cannot be had, with the pace rival from loaded history only', async () => {
      const mine = raceRecord('20260101110000', { user_1: { timeS: 300 } });
      const view = await renderLobby([mine], { ladder, byId: {}, pool: poolOf(raceRecord(OLD_RACE, { user_1: { timeS: 100 } })) });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
      await flush();
      const [cfg] = configLogs();
      expect(cfg.riders.map((r) => r.userId)).toEqual(['user_1', 'ghost:20260101110000:user_1']);
      expect(cfg.rivalKind).toBe('self');
      expect(featuredFailLogs()).toEqual([{
        courseId: COURSE.id, stage: 'record', reason: 'error', error: `cycle-races/${RIVAL_RACE} 404`, lookupMs: expect.any(Number)
      }]);
      // No second lookup: the rival pool is not asked.
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'self', source: 'history', serverLookup: 'skipped', lookupMs: 0 });
      expect(poolCalls()).toEqual([]);
      expect(rideFeaturedLogs()).toEqual([expect.objectContaining({ courseId: COURSE.id, ghostArmed: false })]);
      expect(view.queryByTestId('cgh-ghost-summary')).toBeNull();
    });

    it('a ladder rival whose record has nothing to replay counts as a failed lookup', async () => {
      const empty = raceRecord(RIVAL_RACE, { user_2: { timeS: 250, noSeries: true } });
      const view = await renderLobby([], { ladder, byId: recordsById(empty) });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
      await flush();
      expect(featuredFailLogs()).toEqual([expect.objectContaining({ stage: 'record', reason: 'error', error: 'record not replayable' })]);
      expect(configLogs()[0]).toMatchObject({ rivalKind: 'par' });
      expect(paceRivalLogs()[0]).toMatchObject({ serverLookup: 'skipped' });
    });

    it("the ladder leader riding alone races their own week-best record; no personal-best lookup", async () => {
      const own = raceRecord(RIVAL_RACE, { user_1: { timeS: 250 } });
      const lead = { course: COURSE, standings: [{ userId: 'user_1', raceId: RIVAL_RACE, bestValue: 250 }] };
      const view = await renderLobby([], { ladder: lead, byId: recordsById(own) });
      act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
      await flush();
      expect(callsTo((u) => u.includes('/personal-bests'))).toEqual([]);
      expect(ghostIds(configLogs()[0])).toEqual([`ghost:${RIVAL_RACE}:user_1`]);
      expect(rideFeaturedLogs()[0]).toMatchObject({ rivalKind: 'leader-own-record', ghostArmed: true });
    });

    it('never leaves the lobby frozen if launching the featured race throws: logs start_failed', async () => {
      const view = await renderLobby([], { ladder, byId });
      const boom = new Error('boom');
      logSpy.info.mockImplementation((event) => { if (event === 'cycle_game.config') throw boom; });
      try {
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
        await flush();
      } finally {
        logSpy.info.mockImplementation(() => {});
      }
      expect(logSpy.error).toHaveBeenCalledWith('cycle_game.start_failed', { control: 'featured', error: 'boom' });
      expect(isFrozen(view)).toBe(false);
      expect(rideFeaturedLogs()).toEqual([]);
      expect(view.queryByTestId('cgh-ghost-summary')).toBeNull();
    });

    it('aborts its fetch and starts nothing if the game is closed while it waits', async () => {
      const slow = deferred();
      const view = await renderLobby([], { ladder, byId: { [RIVAL_RACE]: () => slow.promise } });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
      await flush(2);
      const { signal } = recordCalls()[0][1];
      expect(signal.aborted).toBe(false);
      act(() => { view.unmount(); });
      expect(signal.aborted).toBe(true);
      slow.reject(new Error('The operation was aborted.')); // what an aborted fetch does
      await flush();
      expect(configLogs()).toEqual([]);
      expect(rideFeaturedLogs()).toEqual([]);
      expect(logsOf('info', 'cycle_game.start_pressed')).toEqual([]);
      expect(featuredFailLogs()).toEqual([]); // closing the game is not a failed lookup
    });

    describe('timing', () => {
      beforeEach(() => { vi.useFakeTimers(); });
      afterEach(() => { vi.useRealTimers(); });
      // A response that arrives after `ms`.
      const after = (ms, response) => () => new Promise((resolve) => { setTimeout(() => resolve(response), ms); });

      it('Start (lookup pending) then "Ride it": one race, the field from the first press, lobby ghost untouched', async () => {
        const view = await renderLobby([], { ladder, byId, pool: never });
        act(() => { fireEvent.click(view.getByTestId('course-time')); });
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
        await flush();
        await act(async () => { vi.advanceTimersByTime(1500); });
        await flush();
        expect(configLogs()).toHaveLength(1);
        expect(configLogs()[0]).toMatchObject({ winCondition: 'time', rivalKind: 'par' });
        expect(ghostIds(configLogs()[0])).toEqual(['ghost:par:par']);
        expect(logsOf('info', 'cycle_game.ride_featured')).toEqual([]);
        discardRace(view);
        await flush(3);
        expect(view.queryByTestId('cgh-ghost-summary')).toBeNull();
      });

      it('a hung rival fetch freezes the lobby at once and the race starts at 1500 ms without the ladder rival', async () => {
        const mine = raceRecord('20260101110000', { user_1: { timeS: 300 } });
        const hung = deferred();
        const view = await renderLobby([mine], { ladder, byId: { [RIVAL_RACE]: () => hung.promise }, pool: never });
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
        expect(isFrozen(view)).toBe(true);
        expect(view.getByTestId('cycle-game-start').textContent).toContain('Starting…');
        expect(view.getByTestId('featured-ride').disabled).toBe(true);
        await act(async () => { vi.advanceTimersByTime(1499); });
        await flush();
        expect(configLogs()).toEqual([]);
        expect(isFrozen(view)).toBe(true);
        await act(async () => { vi.advanceTimersByTime(1); });
        await flush();
        // 1500 ms after the press: the featured course, with the pace rival from loaded history.
        expect(configLogs()).toHaveLength(1);
        expect(configLogs()[0]).toMatchObject({ winCondition: 'distance', goalM: GOAL_M, rivalKind: 'self' });
        expect(configLogs()[0].riders.map((r) => r.userId)).toEqual(['user_1', 'ghost:20260101110000:user_1']);
        expect(featuredFailLogs()).toEqual([{ courseId: COURSE.id, stage: 'record', reason: 'timeout', error: null, lookupMs: 1500 }]);
        expect(recordCalls()[0][1].signal.aborted).toBe(true);
        expect(paceRivalLogs()[0]).toMatchObject({ kind: 'self', source: 'history', serverLookup: 'skipped' });
        expect(poolCalls()).toEqual([]); // no second budget
        expect(rideFeaturedLogs()).toEqual([expect.objectContaining({ ghostArmed: false })]);
        expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
        // The record arriving late changes nothing.
        hung.resolve({ ok: true, json: () => Promise.resolve({ race: rivalRecord }) });
        await flush();
        expect(configLogs()).toHaveLength(1);
        expect(view.queryByTestId(`ready-rider-ghost:${RIVAL_RACE}:user_2`)).toBeNull();
      });

      it('a rival record that fails after 1000 ms starts the race then, with no pace-rival lookup', async () => {
        const view = await renderLobby([], { ladder, byId: { [RIVAL_RACE]: after(1000, { ok: false, status: 404 }) }, pool: never });
        optInRival(view); act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
        await act(async () => { vi.advanceTimersByTime(999); });
        await flush();
        expect(configLogs()).toEqual([]);
        await act(async () => { vi.advanceTimersByTime(1); });
        await flush();
        expect(configLogs()).toHaveLength(1);
        expect(featuredFailLogs()).toEqual([expect.objectContaining({ stage: 'record', reason: 'error', lookupMs: 1000 })]);
        expect(paceRivalLogs()[0]).toMatchObject({ kind: 'par', source: 'par', serverLookup: 'skipped', lookupMs: 0, recordFetched: false });
        expect(poolCalls()).toEqual([]);
      });
    });
  });

  describe('start guards', () => {
    it('two Start presses in the same tick produce one race', async () => {
      mockCtx = soloCtx({ cycle_ace: 'user_1', tricycle: 'user_2' });
      const view = await renderLobby([]);
      act(() => { fireEvent.click(view.getByTestId('course-distance')); });
      act(() => {
        fireEvent.click(view.getByTestId('cycle-game-start'));
        fireEvent.click(view.getByTestId('cycle-game-start'));
      });
      expect(configLogs()).toHaveLength(1);
      expect(ignoredLogs()).toEqual([{ reason: 'not_idle', control: 'lobby.start-button' }]);
    });

    it('a start with nobody to race reports that it was not accepted', async () => {
      mockCtx = soloCtx({});
      await renderLobby([]);
      let accepted;
      act(() => { accepted = window.__cycleGameControl.startRace({ winCondition: 'time', value: 60 }); });
      expect(accepted).toBe(false);
      expect(logSpy.warn).toHaveBeenCalledWith('cycle_game.staged', expect.objectContaining({ error: 'no_riders' }));
      expect(configLogs()).toEqual([]);
    });

    it('a start that is waiting on its rival lookup reports that it was accepted', async () => {
      const view = await renderLobby([], { pool: never });
      optInRival(view);
      let accepted;
      act(() => { accepted = window.__cycleGameControl.startRace({ winCondition: 'time', value: 60 }); });
      expect(accepted).toBe(true);
      expect(configLogs()).toEqual([]); // still waiting
      expect(isFrozen(view)).toBe(true);
    });

    it('a second start arriving while one is waiting on its lookup is refused', async () => {
      optInRival(await renderLobby([], { pool: never }));
      let first;
      let second;
      act(() => {
        first = window.__cycleGameControl.startRace({ winCondition: 'time', value: 60 });
        second = window.__cycleGameControl.startRace({ winCondition: 'distance', value: 500 });
      });
      expect([first, second]).toEqual([true, false]);
      expect(ignoredLogs()).toEqual([{ reason: 'start_pending', control: 'sim.autostart' }]);
      expect(logsOf('info', 'cycle_game.start_pressed')).toHaveLength(1);
      expect(poolCalls()).toHaveLength(1);
    });

    it('a start invoked after the game has closed does nothing', async () => {
      mockCtx = soloCtx({ cycle_ace: 'user_1', tricycle: 'user_2' });
      const view = await renderLobby([]);
      const control = window.__cycleGameControl; // a caller still holding the handle
      act(() => { view.unmount(); });
      let accepted;
      act(() => { accepted = control.startRace({ winCondition: 'time', value: 60 }); });
      expect(accepted).toBe(false);
      expect(logsOf('info', 'cycle_game.start_pressed')).toEqual([]);
      expect(configLogs()).toEqual([]);
      expect(ignoredLogs()).toEqual([]);
    });

    it('a race launched and cancelled in the same tick leaves the lobby startable', async () => {
      mockCtx = soloCtx({ cycle_ace: 'user_1', tricycle: 'user_2' });
      const view = await renderLobby([]);
      act(() => { fireEvent.click(view.getByTestId('course-distance')); });
      // Both in one batch: the phase state goes idle → countdown → idle without a
      // render in between, so nothing but the cancel itself can reset the guard.
      act(() => {
        window.__cycleGameControl.startRace({ winCondition: 'distance', value: 500 });
        window.__cycleGameControl.cancel();
      });
      expect(stagedLogs()).toHaveLength(1);
      expect(logsOf('info', 'cycle_game.cancelled')).toHaveLength(1);
      expect(view.getByTestId('cycle-game-home')).toBeTruthy();
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
      expect(ignoredLogs()).toEqual([]);
      expect(stagedLogs()).toHaveLength(2);
      expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
    });

    it('a launch that throws halfway leaves no half-built race: start_failed, nothing staged, and Start works again', async () => {
      mockCtx = soloCtx({ cycle_ace: 'user_1', tricycle: 'user_2' });
      const view = await renderLobby([]);
      act(() => { fireEvent.click(view.getByTestId('course-distance')); });
      // The config event is logged after the controller and race meta are set.
      logSpy.info.mockImplementation((event) => { if (event === 'cycle_game.config') throw new Error('boom'); });
      let accepted;
      try {
        act(() => { accepted = window.__cycleGameControl.startRace({ winCondition: 'distance', value: 500 }); });
      } finally {
        logSpy.info.mockImplementation(() => {});
      }
      expect(accepted).toBe(false);
      expect(logSpy.error).toHaveBeenCalledWith('cycle_game.start_failed', { control: 'sim.autostart', error: 'boom' });
      expect(window.__cycleGameControl.getRaceState()).toBeNull(); // no controller left behind
      expect(window.__cycleGameControl.getPhase()).toBe('idle');
      expect(view.getByTestId('cycle-game-home')).toBeTruthy();
      expect(stagedLogs()).toEqual([]);
      // The lobby still starts a race, and it is saved under its own id (no stale meta).
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
      expect(stagedLogs()).toHaveLength(1);
      expect(window.__cycleGameControl.getRaceState()).not.toBeNull();
      discardRace(view);
      expect(logsOf('info', 'cycle_game.cancelled')).toEqual([expect.objectContaining({ raceId: configLogs()[1].raceId })]);
    });
  });

  describe('the pre-race rider strip shows the riders staged for this race', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('a bike claimed by someone else while Start was waiting does not change who is shown', async () => {
      const claims = { cycle_ace: 'user_1' };
      mockCtx = soloCtx(claims);
      const view = await renderLobby([], { pool: never });
      act(() => { fireEvent.click(view.getByTestId('course-distance')); });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
      // Written to the session outside React (hardware rider-select, the simulator).
      claims.cycle_ace = 'user_2';
      claims.tricycle = 'user_1';
      await act(async () => { vi.advanceTimersByTime(1500); });
      await flush();
      const [cfg] = configLogs();
      expect(cfg.riders.map((r) => r.userId)).toEqual(['user_1', 'ghost:par:par']); // the press-time field
      expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
      expect(view.getByTestId('ready-rider-user_1')).toBeTruthy();
      expect(view.queryByTestId('ready-rider-user_2')).toBeNull();
      // And it stays that way as the strip refreshes.
      await act(async () => { vi.advanceTimersByTime(1000); });
      expect(view.queryByTestId('ready-rider-user_2')).toBeNull();
    });

    it("shows the staged rider's live cadence from the bike they were staged on", async () => {
      const claims = { cycle_ace: 'user_1' };
      mockCtx = soloCtx(claims, { staging_buffer_ms: 5000 });
      mockCtx.fitnessSessionInstance.getEquipmentCadence = (id) => ({ rpm: id === 'cycle_ace' ? 77 : 0, connected: true });
      const view = await renderLobby([], { pool: never });
      act(() => { fireEvent.click(view.getByTestId('course-distance')); });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
      await act(async () => { vi.advanceTimersByTime(1500); });
      await flush();
      expect(view.getByTestId('cycle-game-staging')).toBeTruthy();
      // Pedalling before the green light, read from the bike user_1 was staged on.
      expect(view.getByTestId('ready-rider-user_1').className).not.toContain('is-ghost');
      expect(view.getByTestId('ready-rider-user_1').textContent).toContain('77');
      // Rolling start: pedalling is allowed and the chip says so.
      expect(view.getByTestId('ready-rider-user_1').textContent).toContain('READY');
    });

    // Rolling start: the buffer elapsing is the only gate. A rider already
    // pedalling does not hold the race on the "to your bikes" screen.
    it('staging reaches the countdown when the buffer elapses, while a rider is pedalling', async () => {
      const claims = { cycle_ace: 'user_1' };
      mockCtx = soloCtx(claims, { staging_buffer_ms: 5000 });
      mockCtx.fitnessSessionInstance.getEquipmentCadence = () => ({ rpm: 80, connected: true });
      const view = await renderLobby([], { pool: never });
      act(() => { fireEvent.click(view.getByTestId('course-distance')); });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
      await act(async () => { vi.advanceTimersByTime(1500); });
      await flush();
      expect(view.getByTestId('cycle-game-staging')).toBeTruthy();
      expect(view.getByTestId('cycle-game-staging').textContent).toContain('Pedal when you see green.');
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { vi.advanceTimersByTime(1000); });
      }
      expect(view.queryByTestId('cycle-game-staging')).toBeNull();
      expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
      expect(view.queryByTestId('staging-waiting')).toBeNull();
    });

    it('shows NO SIGNAL for a staged rider whose bike is not reporting', async () => {
      const claims = { cycle_ace: 'user_1' };
      mockCtx = soloCtx(claims, { staging_buffer_ms: 5000 });
      mockCtx.fitnessSessionInstance.getEquipmentCadence = () => ({ rpm: 0, connected: false });
      const view = await renderLobby([], { pool: never });
      act(() => { fireEvent.click(view.getByTestId('course-distance')); });
      optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
      // The lobby's sensor check warns first; start anyway.
      act(() => { fireEvent.click(view.getByTestId('sensor-warning-start')); });
      await act(async () => { vi.advanceTimersByTime(1500); });
      await flush();
      const chip = view.getByTestId('ready-rider-user_1');
      expect(chip.textContent).toContain('NO SIGNAL');
      expect(chip.textContent).not.toContain('READY');
    });
  });

  it('shows the automatic rival in the staging ("to your bikes") rider strip', async () => {
    mockCtx = soloCtx({ cycle_ace: 'user_1' }, { staging_buffer_ms: 5000 });
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300 } })]);
    await startRaceOf(view);
    expect(view.getByTestId('cycle-game-staging')).toBeTruthy();
    expect(view.getByTestId('ready-rider-user_1')).toBeTruthy();
    expect(view.getByTestId('ready-rider-ghost:20260101100000:user_1').className).toContain('is-ghost');
  });

  it('shows the automatic rival in the countdown rider strip', async () => {
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300 } })]);
    await startRaceOf(view);
    expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
    expect(view.getByTestId('ready-rider-user_1')).toBeTruthy();
    expect(view.getByTestId('ready-rider-ghost:20260101100000:user_1').className).toContain('is-ghost');
  });

  describe('mid-race', () => {
    let nowMs;
    let nowSpy;
    beforeEach(() => {
      vi.useFakeTimers();
      nowMs = 0;
      nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    });
    afterEach(() => {
      nowSpy.mockRestore();
      vi.useRealTimers();
    });
    // Countdown, green-light hold, then five race ticks in one catch-up.
    const raceFiveSeconds = () => {
      act(() => { vi.advanceTimersByTime(3000); });
      act(() => { vi.advanceTimersByTime(800); });
      nowMs = 5000;
      act(() => { vi.advanceTimersByTime(1000); });
    };
    const parDistanceM = () => {
      const ticks = logsOf('debug', 'cycle_game.tick');
      return ticks[ticks.length - 1].riders.find((r) => r.userId === 'ghost:par:par').distanceM;
    };

    // Solo layout: the rider's own gauge only; the par rival is on the chart,
    // the road and the pace panel ("vs par pace"), never on a gauge.
    it('a solo race against par shows the rider\'s gauge only and the pace panel against par', async () => {
      const view = await renderLobby([]);
      await startRaceOf(view);
      raceFiveSeconds();
      expect(view.getByTestId('race-layout').dataset.mode).toBe('solo');
      const gauges = view.getAllByTestId('cycle-speedometer-rpm').map((el) => parseInt(el.textContent, 10));
      expect(gauges).toEqual([100]);  // the live rider's sensor
      expect(view.getByTestId('pace-delta').textContent).toContain('vs par pace');
      expect(view.queryByTestId('standings-tower')).toBeNull();
      expect(parDistanceM()).toBe(25); // 18 km/h default = 5 m/s
    });

    it('par rides at par_speed_kmh from the cycle_game config', async () => {
      mockCtx = soloCtx({ cycle_ace: 'user_1' }, { par_speed_kmh: 36 });
      const view = await renderLobby([]);
      await startRaceOf(view);
      raceFiveSeconds();
      expect(parDistanceM()).toBe(50); // 36 km/h = 10 m/s
    });

    it('a Start that arrives while a race is running is dropped (sim autostart seam)', async () => {
      mockCtx = soloCtx({ cycle_ace: 'user_1', tricycle: 'user_2' });
      const view = await renderLobby([]);
      await startRaceOf(view);
      raceFiveSeconds();
      let accepted;
      act(() => { accepted = window.__cycleGameControl.startRace({ winCondition: 'time', value: 60 }); });
      expect(accepted).toBe(false);
      expect(ignoredLogs()).toEqual([{ reason: 'not_idle', control: 'sim.autostart' }]);
      expect(logsOf('info', 'cycle_game.start_pressed')).toHaveLength(1);
      expect(configLogs()).toHaveLength(1);
      expect(configLogs()[0].winCondition).toBe('distance');
    });
  });

  it('never writes the automatic rival to the lobby ghost selection, and arms a fresh one next race', async () => {
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300 } })]);
    await startRaceOf(view);
    discardRace(view);
    await flush(3);
    // Back in the lobby with nothing touched: a ghost in lobby state would show
    // as the "vs …" summary (replacing the value stepper) and as a phantom lane.
    expect(view.getByTestId('cycle-game-home')).toBeTruthy();
    expect(view.queryByTestId('cgh-ghost-summary')).toBeNull();
    expect(view.queryByTestId('ghost-slot-ghost:20260101100000:user_1')).toBeNull();
    expect(view.getByTestId('cgh-value')).toBeTruthy();
    // Start again without touching the race type (selecting one clears a ghost).
    optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    await flush();
    const presses = logsOf('info', 'cycle_game.start_pressed');
    expect(presses).toHaveLength(2);
    expect(presses[1]).toMatchObject({ hasGhost: false, raceType: 'distance' });
    const cfgs = configLogs();
    expect(cfgs).toHaveLength(2);
    expect(cfgs[1].rivalKind).toBe('self'); // 'ghost' if it had leaked into lobby state
    expect(paceRivalLogs().map((l) => l.kind)).toEqual(['self', 'self']);
  });
});
