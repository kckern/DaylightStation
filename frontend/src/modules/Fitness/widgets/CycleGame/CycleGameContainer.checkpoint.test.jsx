import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, waitFor } from '@testing-library/react';

// ── mocks (mirrors CycleGameContainer.wallclock.test.jsx) ──────────────────
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy })
}));

let mockCtx;
vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => mockCtx
}));

vi.mock('@/modules/Fitness/nav/usePersistentVolume.js', () => ({
  usePersistentVolume: () => ({ volume: 1, muted: false, setVolume: vi.fn(), toggleMute: vi.fn() })
}));

import CycleGameContainer from './CycleGameContainer.jsx';

const CHECKPOINT_KEY = 'cycleGame.checkpoint';
const RACE_TICK_MS = 1000;
const COUNTDOWN_TICK_MS = 1000;
const GO_HOLD_MS = 800;
const START_COUNTDOWN_S = 3;

function makeCtx(overrides = {}) {
  const riders = { cycle_ace: 'kckern', tricycle: 'felix' };
  const vitals = {
    kckern: { name: 'KC', heartRate: 140, zoneId: 'hot', zoneColor: 'orange' },
    felix: { name: 'Felix', heartRate: 120, zoneId: 'warm', zoneColor: 'yellow' }
  };
  return {
    equipment: [
      { id: 'cycle_ace', name: 'CycleAce', cadence: 49904, wheel_circumference_m: 2.1, eligible_users: ['kckern'] },
      { id: 'tricycle', name: 'Tricycle', cadence: 7153, wheel_circumference_m: 1.2 }
    ],
    configuredUsers: [
      { id: 'kckern', name: 'KC' },
      { id: 'felix', name: 'Felix' }
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
      start_countdown_s: START_COUNTDOWN_S,
      staging_buffer_ms: 0, // skip the "to your bikes" buffer — straight to countdown
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

function driveToGo(renderApi) {
  const { getByTestId } = renderApi;
  act(() => { fireEvent.click(getByTestId('course-distance')); });
  act(() => { fireEvent.click(getByTestId('cycle-game-start')); });
  act(() => { vi.advanceTimersByTime(COUNTDOWN_TICK_MS * START_COUNTDOWN_S); });
}

// A network mock that answers every endpoint the container touches on mount
// (history dates, ladder) plus the save/recover POST — so tests that never
// intentionally drive those paths don't crash on an unhandled fetch shape.
function makeFetchMock() {
  return vi.fn((url, opts) => {
    if (opts && opts.method === 'POST') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }
    if (typeof url === 'string' && url.includes('ladder')) {
      return Promise.resolve({ ok: false, status: 404 }); // no featured course — card hides
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ dates: [] }) });
  });
}

describe('CycleGameContainer — mid-race checkpoint write (audit C1)', () => {
  let nowMs;

  beforeEach(() => {
    mockCtx = makeCtx();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
    global.fetch = makeFetchMock();
    window.sessionStorage.clear();
    vi.useFakeTimers();
    nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it('has written no checkpoint before racing starts', () => {
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    driveToGo(renderApi);
    expect(window.sessionStorage.getItem(CHECKPOINT_KEY)).toBeNull();
  });

  it('writes a checkpoint to sessionStorage on the 5th tick while racing', () => {
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    driveToGo(renderApi);

    // Five wall-clock seconds elapse in one jump — the catch-up loop runs all
    // 5 ticks synchronously within a single interval fire (see the T1 wallclock
    // suite), so tickCountRef reaches exactly 5 and the checkpoint write fires.
    nowMs = 5000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    const raw = window.sessionStorage.getItem(CHECKPOINT_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.raceMeta).toMatchObject({ winCondition: 'distance' });
    expect(parsed.raceMeta.raceId).toBeTruthy();
    expect(parsed.engineState.riders).toBeTruthy();
    expect(Object.keys(parsed.engineState.riders)).toEqual(expect.arrayContaining(['kckern', 'felix']));
    expect(Number.isFinite(parsed.savedAt)).toBe(true);
  });

  it('clears the checkpoint when the race is intentionally cancelled', () => {
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    driveToGo(renderApi);
    nowMs = 5000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
    expect(window.sessionStorage.getItem(CHECKPOINT_KEY)).toBeTruthy(); // sanity: a checkpoint exists

    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); }); // ensure we're past the go-hold, on the race screen
    act(() => { fireEvent.click(renderApi.getByTestId('cycle-game-cancel')); });

    expect(window.sessionStorage.getItem(CHECKPOINT_KEY)).toBeNull();
  });

  it('a normal results save clears the checkpoint', async () => {
    // Flash tier (100 m) — both riders pedal at rpm 100 the whole time (default
    // makeCtx cadence), so the race finishes quickly and cleanly (no DNF/overtime).
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    act(() => { fireEvent.click(renderApi.getByTestId('course-distance')); });
    act(() => { fireEvent.click(renderApi.getByTestId('tier-flash')); });
    act(() => { fireEvent.click(renderApi.getByTestId('cycle-game-start')); });
    act(() => { vi.advanceTimersByTime(COUNTDOWN_TICK_MS * START_COUNTDOWN_S); });

    const setItemSpy = vi.spyOn(window.sessionStorage, 'setItem');

    // Advance one real wall-clock second at a time (rather than one big jump)
    // so the 30-tick-per-fire catch-up cap never truncates the race: felix
    // (tricycle, smaller wheel, 'warm' zone mult 1.5) is the slower of the two
    // and needs ~34 ticks to cross the 100 m line at rpm 100.
    await act(async () => {
      for (let i = 0; i < 40; i += 1) {
        nowMs += RACE_TICK_MS;
        // eslint-disable-next-line no-await-in-loop
        await vi.advanceTimersByTimeAsync(RACE_TICK_MS);
      }
    });

    expect(renderApi.getByTestId('race-results')).toBeTruthy();
    // A mid-race checkpoint DID land at some point (the periodic write fired
    // well before the finish, given the race ran ~34 ticks) — proving there
    // was something for the save effect to actually clear.
    expect(setItemSpy.mock.calls.some(([key]) => key === CHECKPOINT_KEY)).toBe(true);
    expect(logSpy.info).toHaveBeenCalledWith('cycle_game.race_saved', expect.objectContaining({ ok: true }));
    // The successful results save clears the checkpoint it left behind. The
    // save-effect's fetch → ok → clearCheckpoint chain is pure microtasks (no
    // real timers), already flushed by the vi.advanceTimersByTimeAsync loop above.
    expect(window.sessionStorage.getItem(CHECKPOINT_KEY)).toBeNull();
  });
});

describe('CycleGameContainer — mount-time crash recovery (audit C1)', () => {
  beforeEach(() => {
    mockCtx = makeCtx();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
    global.fetch = makeFetchMock();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  function seedCheckpoint({ savedAt = Date.now(), distanceM = 500 } = {}) {
    const raceMeta = {
      raceId: '20260701120000',
      date: new Date(0).toISOString(),
      mode: 'distance',
      winCondition: 'distance',
      goalM: 3000,
      timeCapS: null,
      intervalSeconds: 1,
      backgroundPlexId: null,
      courseId: null
    };
    const engineState = {
      elapsedS: 42,
      finished: false,
      winCondition: 'distance',
      goalM: 3000,
      timeCapS: null,
      riders: {
        kckern: {
          userId: 'kckern',
          displayName: 'KC',
          equipmentId: 'cycle_ace',
          cumulativeDistanceM: distanceM,
          distanceSeries: [distanceM],
          lapSplits: [],
          hrSeries: [140],
          rpmSeries: [90],
          zoneSeries: ['hot'],
          heartRate: 140,
          rpm: 90,
          zoneId: 'hot',
          finishTimeS: null,
          isGhost: false,
          speedKmh: 20,
          hasRpmData: true
        }
      },
      standings: []
    };
    window.sessionStorage.setItem(CHECKPOINT_KEY, JSON.stringify({ raceMeta, engineState, savedAt }));
    return { raceMeta, engineState };
  }

  it('finalizes a fresh checkpoint on mount: saves it, clears it, and logs race_recovered', async () => {
    const { raceMeta } = seedCheckpoint();

    render(<CycleGameContainer />);

    await waitFor(() => {
      expect(logSpy.info).toHaveBeenCalledWith(
        'cycle_game.race_recovered',
        expect.objectContaining({ raceId: raceMeta.raceId, ok: true })
      );
    });

    // The finalize POST actually carried the checkpointed race.
    const postCall = global.fetch.mock.calls.find(([, opts]) => opts && opts.method === 'POST');
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall[1].body);
    expect(body.record.race.id).toBe(raceMeta.raceId);
    expect(body.record.participants.kckern.final_distance_m).toBe(500);

    expect(window.sessionStorage.getItem(CHECKPOINT_KEY)).toBeNull();
  });

  it('discards a stale checkpoint (older than 30 min) without saving, and logs only a debug note', async () => {
    const staleSavedAt = Date.now() - (31 * 60 * 1000);
    seedCheckpoint({ savedAt: staleSavedAt });

    render(<CycleGameContainer />);

    await waitFor(() => {
      expect(logSpy.debug).toHaveBeenCalledWith('cycle_game.checkpoint_discarded', {});
    });

    expect(window.sessionStorage.getItem(CHECKPOINT_KEY)).toBeNull();
    expect(logSpy.info).not.toHaveBeenCalledWith('cycle_game.race_recovered', expect.anything());
    // Never attempted a save POST for the stale checkpoint.
    expect(global.fetch.mock.calls.some(([, opts]) => opts && opts.method === 'POST')).toBe(false);
  });

  it('discards a corrupt checkpoint without saving', async () => {
    window.sessionStorage.setItem(CHECKPOINT_KEY, '{not json');

    render(<CycleGameContainer />);

    await waitFor(() => {
      expect(logSpy.debug).toHaveBeenCalledWith('cycle_game.checkpoint_discarded', {});
    });
    expect(window.sessionStorage.getItem(CHECKPOINT_KEY)).toBeNull();
    expect(global.fetch.mock.calls.some(([, opts]) => opts && opts.method === 'POST')).toBe(false);
  });

  it('discards a zero-distance checkpoint without saving (same guard as the normal save path)', async () => {
    seedCheckpoint({ distanceM: 0 });

    render(<CycleGameContainer />);

    await waitFor(() => {
      expect(logSpy.info).toHaveBeenCalledWith(
        'cycle_game.race_recovered',
        expect.objectContaining({ ok: false, skipped: 'zero_distance' })
      );
    });
    expect(window.sessionStorage.getItem(CHECKPOINT_KEY)).toBeNull();
    expect(global.fetch.mock.calls.some(([, opts]) => opts && opts.method === 'POST')).toBe(false);
  });

  it('does not re-check for a checkpoint on every return to idle (mount-once guard)', async () => {
    const { raceMeta } = seedCheckpoint();
    const renderApi = render(<CycleGameContainer />);

    await waitFor(() => {
      expect(logSpy.info).toHaveBeenCalledWith('cycle_game.race_recovered', expect.objectContaining({ raceId: raceMeta.raceId }));
    });
    const recoveredCallsAfterFirst = logSpy.info.mock.calls.filter(([event]) => event === 'cycle_game.race_recovered').length;

    // Seed a SECOND checkpoint and force the container back through idle (cancel
    // a freshly-staged race). If the recovery check re-ran on every idle entry
    // it would pick this one up too — it must not.
    seedCheckpoint({ raceId: 'should-not-recover' });
    act(() => { fireEvent.click(renderApi.getByTestId('course-distance')); });
    act(() => { fireEvent.click(renderApi.getByTestId('cycle-game-start')); });
    act(() => { fireEvent.click(renderApi.getByTestId('cycle-game-cancel')); });

    const recoveredCallsAfterSecond = logSpy.info.mock.calls.filter(([event]) => event === 'cycle_game.race_recovered').length;
    expect(recoveredCallsAfterSecond).toBe(recoveredCallsAfterFirst);
  });
});
