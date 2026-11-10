import { describe, it, expect, vi, beforeEach } from 'vitest';
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
// A lone rider with no ghost gets a rival: own best at this type + length,
// else the household best, else a constant par pace.
const GOAL_M = 3000; // makeCtx's distance_goal_default_m

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

// Answers the lobby's history load (dates, then one day's races) and the ladder.
function historyFetch(races) {
  return vi.fn((url) => {
    if (typeof url === 'string' && url.includes('ladder')) return Promise.resolve({ ok: false, status: 404 });
    if (typeof url === 'string' && url.includes('?date=')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ races }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: ['2026-01-01'] }) });
  });
}

function soloCtx(riders = { cycle_ace: 'user_1' }) {
  const base = makeCtx();
  return {
    ...base,
    fitnessSessionInstance: { ...base.fitnessSessionInstance, getEquipmentRider: (id) => riders[id] || null }
  };
}

async function renderLobby(races) {
  global.fetch = historyFetch(races);
  const view = render(<CycleGameContainer />);
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(logSpy.info).toHaveBeenCalledWith('cycle_game.history_loaded', expect.objectContaining({ races: races.length }));
  return view;
}

function startDistanceRace({ getByTestId }) {
  act(() => { fireEvent.click(getByTestId('course-distance')); });
  act(() => { fireEvent.click(getByTestId('cycle-game-start')); });
}

const configLogs = () => logSpy.info.mock.calls.filter(([e]) => e === 'cycle_game.config').map(([, d]) => d);
const paceRivalLogs = () => logSpy.info.mock.calls.filter(([e]) => e === 'cycle_game.pace_rival').map(([, d]) => d);
const ghostIds = (cfg) => cfg.riders.filter((r) => r.isGhost).map((r) => r.userId);

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
      sourceRaceId: '20260101110000', participantId: 'user_1'
    }]);
  });

  it('falls to the household best when the rider has no ride of their own', async () => {
    const view = await renderLobby([raceRecord('20260101100000', { user_2: { timeS: 300 } })]);
    startDistanceRace(view);
    const [cfg] = configLogs();
    expect(ghostIds(cfg)).toEqual(['ghost:20260101100000:user_2']);
    expect(cfg.rivalKind).toBe('household');
    expect(paceRivalLogs()).toEqual([expect.objectContaining({ kind: 'household', sourceRaceId: '20260101100000', participantId: 'user_2' })]);
  });

  it('falls to a par pace when there is no history', async () => {
    const view = await renderLobby([]);
    startDistanceRace(view);
    const [cfg] = configLogs();
    expect(ghostIds(cfg)).toEqual(['ghost:par:par']);
    expect(cfg.rivalKind).toBe('par');
    expect(paceRivalLogs()).toEqual([{
      raceId: cfg.raceId, kind: 'par', requestedKind: 'par', sourceRaceId: null, participantId: 'par'
    }]);
  });

  it('falls back to par when the picked ride has nothing to replay', async () => {
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300, noSeries: true } })]);
    startDistanceRace(view);
    const [cfg] = configLogs();
    expect(ghostIds(cfg)).toEqual(['ghost:par:par']);
    expect(cfg.rivalKind).toBe('par');
    expect(paceRivalLogs()).toEqual([expect.objectContaining({ kind: 'par', requestedKind: 'self', sourceRaceId: null })]);
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

  it('shows the automatic rival in the pre-race rider strip', async () => {
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300 } })]);
    startDistanceRace(view);
    expect(view.getByTestId('countdown-stoplight')).toBeTruthy();
    expect(view.getByTestId('ready-rider-user_1')).toBeTruthy();
    expect(view.getByTestId('ready-rider-ghost:20260101100000:user_1').className).toContain('is-ghost');
  });

  it('a par rival, which records distance only, still moves its gauge mid-race', async () => {
    vi.useFakeTimers();
    let nowMs = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
    try {
      const view = await renderLobby([]);
      startDistanceRace(view);
      act(() => { vi.advanceTimersByTime(3000); }); // 3-2-1 countdown
      act(() => { vi.advanceTimersByTime(800); });  // green-light hold
      nowMs = 5000;
      act(() => { vi.advanceTimersByTime(1000); }); // five race ticks
      const gauges = view.getAllByTestId('cycle-speedometer-rpm').map((el) => parseInt(el.textContent, 10));
      expect(gauges).toHaveLength(2);
      // 18 km/h on the default 2.1 m wheel, synthesized from speed (no rpm series).
      expect(gauges).toContain(143);
      expect(gauges.every((rpm) => rpm > 0)).toBe(true);
    } finally {
      nowSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not lock the lobby to the automatic rival, and arms a fresh one next race', async () => {
    const view = await renderLobby([raceRecord('20260101100000', { user_1: { timeS: 300 } })]);
    startDistanceRace(view);
    act(() => { fireEvent.click(view.getByTestId('cycle-game-cancel')); });
    await act(async () => { await Promise.resolve(); });
    expect(view.getByTestId('cycle-game-home')).toBeTruthy();
    expect(view.queryByTestId('cgh-ghost-summary')).toBeNull();
    expect(view.queryByTestId('ghost-slot-ghost:20260101100000:user_1')).toBeNull();
    expect(view.getByTestId('cgh-value')).toBeTruthy(); // the value stepper is still editable
    // A time race next: the distance rival must not carry over.
    act(() => { fireEvent.click(view.getByTestId('course-time')); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const cfgs = configLogs();
    expect(cfgs).toHaveLength(2);
    expect(cfgs[1].winCondition).toBe('time');
    expect(ghostIds(cfgs[1])).toEqual(['ghost:par:par']);
    expect(paceRivalLogs().map((l) => l.kind)).toEqual(['self', 'par']);
  });
});
