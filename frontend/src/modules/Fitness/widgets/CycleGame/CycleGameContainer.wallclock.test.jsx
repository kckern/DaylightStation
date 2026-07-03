import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// ── mocks (mirrors CycleGameContainer.test.jsx) ────────────────────────────
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

// Production constants mirrored here (not exported) — see CycleGameContainer.jsx.
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

// Drive the container from the home screen to the 'go' phase (green light —
// the engine is already live, before the race screen mounts). Returns the
// render helpers. Caller controls performance.now() beforehand via the
// nowRef so the anchor effect captures a known value.
function driveToGo(renderApi) {
  const { getByTestId } = renderApi;
  act(() => { fireEvent.click(getByTestId('course-distance')); });
  act(() => { fireEvent.click(getByTestId('cycle-game-start')); });
  // 3 countdown ticks (start_countdown_s = 3) flips controller phase to
  // 'racing' on the last one, which the container renders as 'go'.
  act(() => { vi.advanceTimersByTime(COUNTDOWN_TICK_MS * START_COUNTDOWN_S); });
}

describe('CycleGameContainer — wall-clock race ticks (audit F8)', () => {
  let nowMs;

  beforeEach(() => {
    mockCtx = makeCtx();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
    global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
    vi.useFakeTimers();
    nowMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('catches up to wall-clock elapsed time when a fire is late (one late fire ⇒ ~5 ticks)', () => {
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0; // anchor value the 'go' transition below will capture
    driveToGo(renderApi);

    // Simulate the browser tab freezing for ~5s: real time jumps 5000ms ahead
    // but the fake-timer engine only fires the 1000ms race interval ONCE.
    nowMs = 5000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    const tickCalls = logSpy.debug.mock.calls.filter(([event]) => event === 'cycle_game.tick');
    expect(tickCalls.length).toBe(5);
    expect(tickCalls.map(([, payload]) => payload.tick)).toEqual([1, 2, 3, 4, 5]);

    expect(logSpy.warn).toHaveBeenCalledWith(
      'cycle_game.tick_catchup',
      expect.objectContaining({ dueTicks: 5, ranTicks: 5 })
    );
  });

  it('caps catch-up at 30 ticks per fire on an extreme freeze', () => {
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    driveToGo(renderApi);

    nowMs = 60000; // 60 real seconds elapsed in one jump
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    const tickCalls = logSpy.debug.mock.calls.filter(([event]) => event === 'cycle_game.tick');
    expect(tickCalls.length).toBe(30);
    expect(logSpy.warn).toHaveBeenCalledWith(
      'cycle_game.tick_catchup',
      expect.objectContaining({ dueTicks: 60, ranTicks: 30 })
    );
  });

  it('does not tear down / recreate the race interval on the go→racing transition', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    driveToGo(renderApi);
    expect(renderApi.queryByTestId('countdown-stoplight')).toBeTruthy(); // still on the green-light screen ('go')

    const setCallsAtGo = setIntervalSpy.mock.calls.length;
    const clearCallsAtGo = clearIntervalSpy.mock.calls.length;

    // Advance through the go-hold (< RACE_TICK_MS, so no tick fires here either —
    // isolates the assertion to interval churn, not tick behavior).
    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });

    expect(setIntervalSpy.mock.calls.length).toBe(setCallsAtGo);
    expect(clearIntervalSpy.mock.calls.length).toBe(clearCallsAtGo);
  });

  it('keeps ticking continuously across the go→racing edge (no dead/duplicated ticks)', () => {
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    driveToGo(renderApi);

    // Cross into 'racing' (GO_HOLD_MS), then let one full wall-clock second pass.
    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
    nowMs = 1000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS - GO_HOLD_MS); });

    const tickCalls = logSpy.debug.mock.calls.filter(([event]) => event === 'cycle_game.tick');
    // Exactly one tick — the wall clock advanced exactly one interval's worth,
    // not two (which a torn-down/recreated interval double-arming could cause)
    // and not zero (which a dropped interval would cause).
    expect(tickCalls.length).toBe(1);
    expect(logSpy.warn).not.toHaveBeenCalledWith('cycle_game.tick_catchup', expect.anything());
  });

  it('logs a rider_overtime edge (never rider_dnf) for a mercy-kill straggler (audit game-design #7)', () => {
    // kckern (cycle_ace) rides hard and finishes the 100 m "Flash" tier fast;
    // felix (tricycle) crawls the whole time (rpm > 0 — never idle-quits) and is
    // still short of the line when the mercy window closes 3s after the winner.
    mockCtx = makeCtx({
      cycleGameConfig: {
        default_win_condition: 'distance',
        distance_goal_default_m: 3000,
        time_cap_default_s: 300,
        hrless_multiplier: 1.0,
        start_countdown_s: START_COUNTDOWN_S,
        staging_buffer_ms: 0,
        cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }],
        race_mercy_after_winner_s: 3
      },
      fitnessSessionInstance: {
        getEquipmentRider: (id) => ({ cycle_ace: 'kckern', tricycle: 'felix' })[id] || null,
        getEquipmentCadence: (id) => (id === 'cycle_ace' ? { rpm: 100, connected: true } : { rpm: 1, connected: true })
      }
    });
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    act(() => { fireEvent.click(renderApi.getByTestId('course-distance')); });
    act(() => { fireEvent.click(renderApi.getByTestId('tier-flash')); }); // 100 m goal — fast to resolve
    act(() => { fireEvent.click(renderApi.getByTestId('cycle-game-start')); });
    act(() => { vi.advanceTimersByTime(COUNTDOWN_TICK_MS * START_COUNTDOWN_S); });

    // 20 wall-clock seconds: enough for kckern to cross the line (~15 ticks) and
    // for the 3s mercy window to close on felix afterward.
    nowMs = 20000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    const overtimeCalls = logSpy.info.mock.calls.filter(([event]) => event === 'cycle_game.rider_overtime');
    expect(overtimeCalls.length).toBe(1);
    expect(overtimeCalls[0][1]).toMatchObject({ userId: 'felix' });

    // The whole point of the audit fix: felix rode the entire time — the closure
    // must never be logged (or later rendered) as a DNF.
    const dnfCalls = logSpy.info.mock.calls.filter(([event]) => event === 'cycle_game.rider_dnf');
    expect(dnfCalls).toHaveLength(0);

    expect(renderApi.getByTestId('race-results')).toBeTruthy();
  });

  it('a permanently dead sensor rides through the capped hold, gets flagged sensor_lost, then idle-DNFs (audit game-design #6)', () => {
    // felix's sensor connects for the first two ticks (so he "starts" — registers
    // movement — before it dies), then never reconnects. With the pre-fix
    // unbounded hold, rpmDuringGap would keep returning his last rpm forever:
    // infinite counted distance, and the idle-DNF clock (fed a real 0) could
    // never fire. race_idle_dnf_s is lowered to 5 purely to keep the fixture's
    // tick count small — the mechanism under test is the CAP, not the threshold.
    let felixConnected = true;
    mockCtx = makeCtx({
      cycleGameConfig: {
        default_win_condition: 'distance',
        distance_goal_default_m: 3000,
        time_cap_default_s: 300,
        hrless_multiplier: 1.0,
        start_countdown_s: START_COUNTDOWN_S,
        staging_buffer_ms: 0,
        cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }],
        race_idle_dnf_s: 5
      },
      fitnessSessionInstance: {
        getEquipmentRider: (id) => ({ cycle_ace: 'kckern', tricycle: 'felix' })[id] || null,
        getEquipmentCadence: (id) => {
          if (id === 'cycle_ace') return { rpm: 100, connected: true }; // kckern rides on, unaffected
          return { rpm: 100, connected: felixConnected };
        }
      }
    });
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    driveToGo(renderApi);

    // Two connected ticks — felix registers movement (past the start-grace path).
    nowMs = 2000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    felixConnected = false;
    // 13 more ticks: gap ticks 1-5 hold, 6-8 decay, 9-13 are true zeros — the
    // 5th consecutive zero (race_idle_dnf_s: 5) trips the idle-DNF at gap tick 13.
    nowMs = 2000 + 13000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    const sensorLostCalls = logSpy.info.mock.calls.filter(([event]) => event === 'cycle_game.sensor_lost');
    expect(sensorLostCalls).toHaveLength(1); // edge-only, not once per tick
    expect(sensorLostCalls[0][1]).toMatchObject({ userId: 'felix', equipmentId: 'tricycle' });

    // kckern's sensor never dropped — never flagged.
    expect(sensorLostCalls.some(([, p]) => p.userId === 'kckern')).toBe(false);

    // The consequence the audit demanded: the hold now expires to a real 0,
    // so the controller's existing idle-DNF clock (previously starved by the
    // infinite hold) finally fires for felix.
    const dnfCalls = logSpy.info.mock.calls.filter(([event]) => event === 'cycle_game.rider_dnf');
    expect(dnfCalls.map(([, p]) => p.userId)).toContain('felix');
  });

  it('clears the sensor_lost flag and logs sensor_recovered once the sensor reconnects', () => {
    let felixConnected = true;
    mockCtx = makeCtx({
      cycleGameConfig: {
        default_win_condition: 'distance',
        distance_goal_default_m: 3000,
        time_cap_default_s: 300,
        hrless_multiplier: 1.0,
        start_countdown_s: START_COUNTDOWN_S,
        staging_buffer_ms: 0,
        cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }],
        race_idle_dnf_s: 5
      },
      fitnessSessionInstance: {
        getEquipmentRider: (id) => ({ cycle_ace: 'kckern', tricycle: 'felix' })[id] || null,
        getEquipmentCadence: (id) => {
          if (id === 'cycle_ace') return { rpm: 100, connected: true };
          return { rpm: 100, connected: felixConnected };
        }
      }
    });
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    driveToGo(renderApi);

    nowMs = 2000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    felixConnected = false;
    // Cross SENSOR_LOST_GAP_TICKS (9) but stop short of the idle-DNF window.
    nowMs = 2000 + 9000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
    expect(logSpy.info.mock.calls.filter(([event]) => event === 'cycle_game.sensor_lost')).toHaveLength(1);

    felixConnected = true;
    nowMs = 2000 + 9000 + 1000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    const recoveredCalls = logSpy.info.mock.calls.filter(([event]) => event === 'cycle_game.sensor_recovered');
    expect(recoveredCalls).toHaveLength(1);
    expect(recoveredCalls[0][1]).toMatchObject({ userId: 'felix', equipmentId: 'tricycle' });
  });

  it('never flags sensor_lost for a rider who has not pedaled a single connected reading yet (cold start, not a dropout)', () => {
    // A rider who hasn't started pedaling at race start (still mounting the
    // bike, clipping in) reads exactly like felix's dropout case above from
    // gapTicks alone — but rpmHistoryRef is empty, because there was never a
    // real reading to begin with. raceStartGraceS (30s) already covers this
    // gracefully at the DNF layer; SENSOR must not fire a false alarm here.
    mockCtx = makeCtx({
      cycleGameConfig: {
        default_win_condition: 'distance',
        distance_goal_default_m: 3000,
        time_cap_default_s: 300,
        hrless_multiplier: 1.0,
        start_countdown_s: START_COUNTDOWN_S,
        staging_buffer_ms: 0,
        cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }],
        race_start_grace_s: 30
      },
      fitnessSessionInstance: {
        getEquipmentRider: (id) => ({ cycle_ace: 'kckern', tricycle: 'felix' })[id] || null,
        getEquipmentCadence: (id) => {
          if (id === 'cycle_ace') return { rpm: 100, connected: true }; // kckern rides normally
          return { rpm: 0, connected: false }; // felix hasn't clipped in yet
        }
      }
    });
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    driveToGo(renderApi);

    // Well past SENSOR_LOST_GAP_TICKS (9) — the exact live-garage repro was
    // a false SENSOR chip at elapsedS:9 for a rider who simply hadn't
    // started pedaling. Stop short of the 30s start-grace DNF window.
    nowMs = 20000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    expect(logSpy.info.mock.calls.some(([event]) => event === 'cycle_game.sensor_lost')).toBe(false);
  });
});
