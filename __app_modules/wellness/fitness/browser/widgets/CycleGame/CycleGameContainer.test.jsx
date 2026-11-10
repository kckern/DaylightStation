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
import { DEFAULT_WHEEL_CIRCUMFERENCE_M } from "../../lib/cycleGame/distanceModel.js";
import { SessionSerializerV3 } from "../../hooks/fitness/SessionSerializerV3.js";

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
    // Cancel must NOT appear on the home/idle screen.
    expect(queryByTestId('cycle-game-cancel')).toBeNull();
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
// A lone rider with no ghost gets a rival: own best at this type + length (the
// server's personal best, else loaded history), else the household best in
// loaded history, else a constant par pace.
const GOAL_M = 3000; // makeCtx's distance_goal_default_m
const COURSE = { id: 'course-3k', win_condition: 'distance', goal_m: GOAL_M };
const PB_RACE = '20250505100000'; // older than anything the lobby loads

function raceRecord(id, participants, race = {}) {
  return {
    version: 1,
    race: { id, win_condition: 'distance', goal_m: GOAL_M, interval_seconds: 1, ...race },
    participants: Object.fromEntries(Object.entries(participants).map(([userId, p], i) => [userId, {
      display_name: userId,
      final_distance_m: GOAL_M,
      final_time_s: p.timeS,
      placement: i + 1,
      distance_series: p.noSeries ? null : SessionSerializerV3.encodeSeries([GOAL_M / 2, GOAL_M])
    }]))
  };
}

const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const notFound = () => Promise.resolve({ ok: false, status: 404 });

// Answers everything the container asks: the lobby's history load (dates, then
// one day's races), the ladder, the personal-best lookup and single-race reads.
//   ladder: the /ladder body (default: 404, no featured course)
//   pb:     (url) => Response promise for /personal-bests (default: no best)
//   byId:   { raceId: record } for /cycle-races/<raceId>
function historyFetch(races, { ladder = null, pb = null, byId = {} } = {}) {
  return vi.fn((url) => {
    const u = String(url);
    if (u.includes('/ladder')) return ladder ? json(ladder) : notFound();
    if (u.includes('/personal-bests')) return pb ? pb(u) : json({ best: null });
    if (u.includes('?date=')) return json({ races });
    const one = u.match(/\/cycle-races\/(\d+)$/);
    if (one) return byId[one[1]] ? json({ race: byId[one[1]] }) : notFound();
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

function startDistanceRace({ getByTestId }) {
  act(() => { fireEvent.click(getByTestId('course-distance')); });
  act(() => { fireEvent.click(getByTestId('cycle-game-start')); });
}

const logsOf = (level, event) => logSpy[level].mock.calls.filter(([e]) => e === event).map(([, d]) => d);
const configLogs = () => logsOf('info', 'cycle_game.config');
const paceRivalLogs = () => logsOf('info', 'cycle_game.pace_rival');
const ghostIds = (cfg) => cfg.riders.filter((r) => r.isGhost).map((r) => r.userId);
const fetchedUrls = () => global.fetch.mock.calls.map(([u]) => String(u));

describe('CycleGameContainer — automatic pace rival', () => {
  beforeEach(() => {
    mockCtx = soloCtx();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
  });

  it("a lone rider with no ghost races their own best at this type and length", async () => {
    const view = await renderLobby([
      raceRecord('20260101100000', { user_1: { timeS: 400 } }),
      raceRecord('20260101110000', { user_1: { timeS: 300 }, user_2: { timeS: 200 } }),
      raceRecord('20260101120000', { user_1: { timeS: 100 } }, { goal_m: 1000 }) // other length: ignored
    ]);
    startDistanceRace(view);
    const [cfg] = configLogs();
    expect(ghostIds(cfg)).toEqual(['ghost:20260101110000:user_1']);
    expect(cfg.rivalKind).toBe('self');
    expect(paceRivalLogs()).toEqual([{
      raceId: cfg.raceId, kind: 'self', requestedKind: 'self',
      sourceRaceId: '20260101110000', participantId: 'user_1',
      source: 'history', candidates: 3, historyLoaded: true, serverLookup: 'skipped'
    }]);
    // No featured course has this type + length, so the server is never asked.
    expect(fetchedUrls().some((u) => u.includes('personal-bests'))).toBe(false);
  });

  it('falls to the household best when the rider has no ride of their own', async () => {
    const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })]);
    startDistanceRace(view);
    const [cfg] = configLogs();
    expect(ghostIds(cfg)).toEqual(['ghost:20260101100000:user_2']);
    expect(cfg.rivalKind).toBe('household');
    expect(paceRivalLogs()).toEqual([expect.objectContaining({
      kind: 'household', sourceRaceId: '20260101100000', participantId: 'user_2', source: 'history', candidates: 1
    })]);
  });

  it('falls to a par pace when there is no history', async () => {
    const view = await renderLobby([]);
    startDistanceRace(view);
    const [cfg] = configLogs();
    expect(ghostIds(cfg)).toEqual(['ghost:par:par']);
    expect(cfg.rivalKind).toBe('par');
    expect(paceRivalLogs()).toEqual([{
      raceId: cfg.raceId, kind: 'par', requestedKind: 'par', sourceRaceId: null, participantId: 'par',
      source: 'par', candidates: 0, historyLoaded: true, serverLookup: 'skipped'
    }]);
  });

  it('says so when Start is pressed before the history has loaded', async () => {
    global.fetch = vi.fn(() => new Promise(() => {})); // nothing ever answers
    const view = render(<CycleGameContainer />);
    startDistanceRace(view);
    expect(paceRivalLogs()).toEqual([expect.objectContaining({ kind: 'par', candidates: 0, historyLoaded: false })]);
  });

  it('falls back to par when the picked ride has nothing to replay', async () => {
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300, noSeries: true } })]);
    startDistanceRace(view);
    const [cfg] = configLogs();
    expect(ghostIds(cfg)).toEqual(['ghost:par:par']);
    expect(cfg.rivalKind).toBe('par');
    expect(paceRivalLogs()).toEqual([expect.objectContaining({ kind: 'par', requestedKind: 'self', sourceRaceId: null, source: 'par' })]);
  });

  it("reports kind 'none' and starts without a rival when even par cannot be built", async () => {
    // A 5-hour time race is past par's four-hour sample cap.
    mockCtx = soloCtx({ cycle_ace: 'user_1' }, { time_cap_default_s: 18000 });
    const view = await renderLobby([]);
    act(() => { fireEvent.click(view.getByTestId('course-time')); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const [cfg] = configLogs();
    expect(cfg.timeCapS).toBe(18000);
    expect(cfg.riders.map((r) => r.userId)).toEqual(['user_1']);
    expect(cfg.rivalKind).toBeNull();
    expect(paceRivalLogs()).toEqual([expect.objectContaining({
      kind: 'none', requestedKind: 'par', sourceRaceId: null, participantId: null
    })]);
  });

  it('two claimed riders race each other: no rival, no pace_rival event', async () => {
    mockCtx = soloCtx({ cycle_ace: 'user_1', tricycle: 'user_2' });
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300 } })]);
    startDistanceRace(view);
    const [cfg] = configLogs();
    expect(ghostIds(cfg)).toEqual([]);
    expect(cfg.rivalKind).toBeNull();
    expect(paceRivalLogs()).toEqual([]);
  });

  it('a hand-picked ghost races alone: no automatic rival is added', async () => {
    const view = await renderLobby([
      raceRecord('20260101100000', { user_2: { timeS: 400 } }),
      raceRecord('20260101110000', { user_1: { timeS: 300 } }) // would be the automatic pick
    ]);
    act(() => { fireEvent.click(view.getByTestId('course-ghost')); });
    act(() => { fireEvent.click(view.getByTestId('ghost-20260101100000')); }); // focus
    act(() => { fireEvent.click(view.getByTestId('ghost-20260101100000')); }); // commit
    expect(view.getByTestId('cgh-ghost-summary')).toBeTruthy();
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const [cfg] = configLogs();
    expect(ghostIds(cfg)).toEqual(['ghost:20260101100000:user_2']);
    expect(cfg.rivalKind).toBe('ghost');
    expect(paceRivalLogs()).toEqual([]);
  });

  describe('featured-course ride (ladder rival passed as the ghost override)', () => {
    const ladder = { course: COURSE, standings: [{ userId: 'user_2', raceId: '20251201100000', bestValue: 250 }] };
    const byId = { 20251201100000: raceRecord('20251201100000', { user_2: { timeS: 250 } }) };

    it("a ladder rival is the rider's rival: rivalKind 'ghost', no automatic rival", async () => {
      const view = await renderLobby([raceRecord('20260101110000', { user_1: { timeS: 300 } })], { ladder, byId });
      act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
      await flush();
      const [cfg] = configLogs();
      expect(cfg.riders.map((r) => r.userId)).toEqual(['user_1', 'ghost:20251201100000:user_2']);
      expect(cfg.rivalKind).toBe('ghost');
      expect(paceRivalLogs()).toEqual([]);
    });

    it('with no bike claimed it still starts, as a ghost-only race', async () => {
      mockCtx = soloCtx({});
      const view = await renderLobby([], { ladder, byId });
      act(() => { fireEvent.click(view.getByTestId('featured-ride')); });
      await flush();
      expect(logSpy.warn).not.toHaveBeenCalledWith('cycle_game.staged', expect.objectContaining({ error: 'no_riders' }));
      const [cfg] = configLogs();
      expect(cfg.riders.map((r) => r.userId)).toEqual(['ghost:20251201100000:user_2']);
      expect(cfg.rivalKind).toBe('ghost');
      expect(paceRivalLogs()).toEqual([]);
      expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
    });
  });

  describe("the rider's server personal best (a race type + length that is a featured course)", () => {
    const pbRecord = raceRecord(PB_RACE, { user_2: { timeS: 200 }, user_1: { timeS: 240 } });
    const pbHit = () => json({ userId: 'user_1', courseId: COURSE.id, best: { raceId: PB_RACE, bestValue: 240 } });

    beforeEach(() => {
      mockCtx = soloCtx({ cycle_ace: 'user_1' }, { featured_courses: [COURSE] });
    });

    it('is used when the loaded history has no ride of theirs', async () => {
      const view = await renderLobby([], { pb: pbHit, byId: { [PB_RACE]: pbRecord } });
      startDistanceRace(view);
      expect(configLogs()).toEqual([]); // waiting on the server
      await flush();
      const [cfg] = configLogs();
      expect(ghostIds(cfg)).toEqual([`ghost:${PB_RACE}:user_1`]); // the rider only, not the race's winner
      expect(cfg.rivalKind).toBe('self');
      expect(paceRivalLogs()).toEqual([{
        raceId: cfg.raceId, kind: 'self', requestedKind: 'self', sourceRaceId: PB_RACE, participantId: 'user_1',
        source: 'server-pb', candidates: 0, historyLoaded: true, serverLookup: 'used'
      }]);
      const pbUrl = fetchedUrls().find((u) => u.includes('personal-bests'));
      expect(pbUrl).toContain('userId=user_1');
      expect(pbUrl).toContain(`courseId=${COURSE.id}`);
      expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
    });

    it('beats a slower ride of theirs in the loaded history', async () => {
      const view = await renderLobby([raceRecord('20260101110000', { user_1: { timeS: 300 } })],
        { pb: pbHit, byId: { [PB_RACE]: pbRecord } });
      startDistanceRace(view);
      await flush();
      expect(ghostIds(configLogs()[0])).toEqual([`ghost:${PB_RACE}:user_1`]);
    });

    it('does not fetch the record again when that race is already in the loaded history', async () => {
      const local = raceRecord('20260101110000', { user_1: { timeS: 300 } });
      const view = await renderLobby([local],
        { pb: () => json({ best: { raceId: '20260101110000' } }) });
      startDistanceRace(view);
      await flush();
      expect(ghostIds(configLogs()[0])).toEqual(['ghost:20260101110000:user_1']);
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'self', source: 'server-pb', serverLookup: 'used' });
      expect(fetchedUrls().some((u) => u.endsWith('/cycle-races/20260101110000'))).toBe(false);
    });

    it('falls back to loaded history when the server has no best', async () => {
      const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })]);
      startDistanceRace(view);
      await flush();
      expect(ghostIds(configLogs()[0])).toEqual(['ghost:20260101100000:user_2']);
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'household', source: 'history', serverLookup: 'none' });
    });

    it('falls back to loaded history when the request fails', async () => {
      const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })],
        { pb: () => Promise.reject(new Error('offline')) });
      startDistanceRace(view);
      await flush();
      expect(ghostIds(configLogs()[0])).toEqual(['ghost:20260101100000:user_2']);
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'household', source: 'history', serverLookup: 'error' });
    });

    it('falls back when the best the server names is not this race type and length', async () => {
      const other = raceRecord(PB_RACE, { user_1: { timeS: 100 } }, { goal_m: 1000 });
      const view = await renderLobby([], { pb: pbHit, byId: { [PB_RACE]: other } });
      startDistanceRace(view);
      await flush();
      expect(ghostIds(configLogs()[0])).toEqual(['ghost:par:par']);
      expect(paceRivalLogs()[0]).toMatchObject({ kind: 'par', source: 'par', serverLookup: 'unusable' });
    });

    describe('with a server that does not answer', () => {
      beforeEach(() => { vi.useFakeTimers(); });
      afterEach(() => { vi.useRealTimers(); });
      const never = () => new Promise(() => {});

      it('waits 1500 ms, then starts the race with the local pick', async () => {
        const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })], { pb: never });
        startDistanceRace(view);
        await act(async () => { vi.advanceTimersByTime(1499); });
        expect(configLogs()).toEqual([]);
        expect(view.getByTestId('cycle-game-home')).toBeTruthy();
        await act(async () => { vi.advanceTimersByTime(1); });
        await flush();
        expect(ghostIds(configLogs()[0])).toEqual(['ghost:20260101100000:user_2']);
        expect(paceRivalLogs()[0]).toMatchObject({ kind: 'household', source: 'history', serverLookup: 'timeout' });
        expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
      });

      it('ignores a second Start press while the lookup is pending: one race', async () => {
        const view = await renderLobby([], { pb: never });
        startDistanceRace(view);
        act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
        act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
        await act(async () => { vi.advanceTimersByTime(1500); });
        await flush();
        expect(configLogs()).toHaveLength(1);
        expect(paceRivalLogs()).toHaveLength(1);
        expect(logsOf('info', 'cycle_game.start_pressed')).toHaveLength(1);
        expect(logsOf('info', 'cycle_game.start_ignored')).toEqual([{ reason: 'start_pending' }, { reason: 'start_pending' }]);
      });

      it('starts nothing if the game is closed before the lookup resolves', async () => {
        const view = await renderLobby([], { pb: never });
        startDistanceRace(view);
        act(() => { view.unmount(); });
        await act(async () => { vi.advanceTimersByTime(1500); });
        await flush();
        expect(configLogs()).toEqual([]);
        expect(paceRivalLogs()).toEqual([]);
      });
    });
  });

  it('shows the automatic rival in the staging ("to your bikes") rider strip', async () => {
    mockCtx = soloCtx({ cycle_ace: 'user_1' }, { staging_buffer_ms: 5000 });
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300 } })]);
    startDistanceRace(view);
    expect(view.getByTestId('cycle-game-staging')).toBeTruthy();
    expect(view.getByTestId('ready-rider-user_1')).toBeTruthy();
    expect(view.getByTestId('ready-rider-ghost:20260101100000:user_1').className).toContain('is-ghost');
  });

  it('shows the automatic rival in the countdown rider strip', async () => {
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300 } })]);
    startDistanceRace(view);
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

    it("the par rival's gauge reads its constant 80 rpm cadence", async () => {
      const view = await renderLobby([]);
      startDistanceRace(view);
      raceFiveSeconds();
      const gauges = view.getAllByTestId('cycle-speedometer-rpm').map((el) => parseInt(el.textContent, 10));
      expect(gauges).toHaveLength(2);
      expect(gauges).toContain(80);   // par
      expect(gauges).toContain(100);  // the live rider's sensor
      expect(parDistanceM()).toBe(25); // 18 km/h default = 5 m/s
    });

    it('par rides at par_speed_kmh from the cycle_game config', async () => {
      mockCtx = soloCtx({ cycle_ace: 'user_1' }, { par_speed_kmh: 36 });
      const view = await renderLobby([]);
      startDistanceRace(view);
      raceFiveSeconds();
      expect(parDistanceM()).toBe(50); // 36 km/h = 10 m/s
    });
  });

  it('never writes the automatic rival to the lobby ghost selection, and arms a fresh one next race', async () => {
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300 } })]);
    startDistanceRace(view);
    act(() => { fireEvent.click(view.getByTestId('cycle-game-cancel')); });
    await flush(3);
    // Back in the lobby with nothing touched: a ghost in lobby state would show
    // as the "vs …" summary (replacing the value stepper) and as a phantom lane.
    expect(view.getByTestId('cycle-game-home')).toBeTruthy();
    expect(view.queryByTestId('cgh-ghost-summary')).toBeNull();
    expect(view.queryByTestId('ghost-slot-ghost:20260101100000:user_1')).toBeNull();
    expect(view.getByTestId('cgh-value')).toBeTruthy();
    // Start again without touching the race type (selecting one clears a ghost).
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const presses = logsOf('info', 'cycle_game.start_pressed');
    expect(presses).toHaveLength(2);
    expect(presses[1]).toMatchObject({ hasGhost: false, raceType: 'distance' });
    const cfgs = configLogs();
    expect(cfgs).toHaveLength(2);
    expect(cfgs[1].rivalKind).toBe('self'); // 'ghost' if it had leaked into lobby state
    expect(paceRivalLogs().map((l) => l.kind)).toEqual(['self', 'self']);
  });
});
