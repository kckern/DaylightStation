import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// The boost meter: the heart-rate zone multiplies distance. The container
// feeds each rider's boostState to the gauge, the zone range to the lobby's
// rule line, the strapless handicap to the ready strip, and announces a zone
// going UP mid-race (one toast; both directions logged).
//
// ── mocks (mirrors CycleGameContainer.parked.test.jsx) ────────────────────
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), sampled: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy })
}));

let mockCtx;
vi.mock("../../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => mockCtx
}));

vi.mock("../../nav/usePersistentVolume.js", () => ({
  usePersistentVolume: () => ({ volume: 1, muted: false, setVolume: vi.fn(), toggleMute: vi.fn() })
}));

import CycleGameContainer from "./CycleGameContainer.jsx";

const RACE_TICK_MS = 1000;
const GO_HOLD_MS = 800;
const START_COUNTDOWN_S = 3;

let vitals;

function makeCtx(cycleGameConfig = {}) {
  const riders = { cycle_ace: 'user_1', tricycle: 'user_2' };
  return {
    equipment: [
      { id: 'cycle_ace', name: 'CycleAce', cadence: 49904, wheel_circumference_m: 2.1, eligible_users: ['user_1'] },
      { id: 'tricycle', name: 'Tricycle', cadence: 7153, wheel_circumference_m: 1.2 }
    ],
    configuredUsers: [
      { id: 'user_1', name: 'User_1' },
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
      hrless_multiplier: 0.8,
      start_countdown_s: START_COUNTDOWN_S,
      staging_buffer_ms: 0,
      cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }],
      ...cycleGameConfig
    },
    fitnessSessionInstance: {
      getEquipmentRider: (id) => riders[id] || null,
      getEquipmentCadence: () => ({ rpm: 90, connected: true })
    },
    getUserVitals: (id) => vitals[id] || null,
    getDisplayName: (id) => id,
    getUserByName: (id) => ({ name: vitals[id]?.name || id }),
    setGovernanceSuspended: vi.fn()
  };
}

const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
function makeFetch() {
  return vi.fn((url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'POST') return json({});
    if (u.includes('/ladder')) return Promise.resolve({ ok: false, status: 404 });
    if (u.includes('/personal-bests')) return json({ best: null });
    if (u.includes('/rival-pool')) return json({ entries: [] });
    return json({ dates: [] });
  });
}

const logsOf = (level, event) => logSpy[level].mock.calls.filter(([e]) => e === event).map(([, d]) => d);

describe('CycleGameContainer — boost meter', () => {
  let nowMs;

  beforeEach(() => {
    vitals = {
      user_1: { name: 'User_1', heartRate: 160, zoneId: 'hot', zoneColor: 'orange', progress: null },
      user_2: { name: 'User_2', heartRate: 120, zoneId: 'warm', zoneColor: 'yellow', progress: 0.5 }
    };
    Object.values(logSpy).forEach((fn) => fn.mockClear());
    global.fetch = makeFetch();
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

  const startDistanceRace = (view) => {
    act(() => { fireEvent.click(view.getByTestId('course-distance')); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const anyway = view.queryByTestId('sensor-warning-start');
    if (anyway) act(() => { fireEvent.click(anyway); });
  };
  const toCountdown = () => {
    act(() => { vi.advanceTimersByTime(1000); });
  };
  const toRacing = () => {
    act(() => { vi.advanceTimersByTime(1000 * START_COUNTDOWN_S); });
    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
    nowMs = 1000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
  };
  const tick = (n = 1) => {
    for (let i = 0; i < n; i += 1) {
      nowMs += RACE_TICK_MS;
      act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
    }
  };
  const boostOf = (view, i) => view.getAllByTestId('cycle-speedometer-rpm')[i]
    .closest('.cycle-speedometer').querySelector('[data-testid="cycle-speedometer-boost"]');
  const toastText = (view) => view.queryByTestId('cycle-event-toast')?.textContent || '';

  it('the lobby states the boost rule from the zone range, strapless multiplier included', () => {
    mockCtx = makeCtx();
    const view = render(<CycleGameContainer />);
    expect(view.getByTestId('boost-rule').textContent).toContain('×0.8 to ×2');
  });

  it('each gauge carries its rider\'s boost: zone, multiplier, progress and the next step', () => {
    mockCtx = makeCtx();
    const view = render(<CycleGameContainer />);
    startDistanceRace(view);
    toRacing();
    tick(1);
    const hot = boostOf(view, 0);
    expect(hot.querySelector('[data-testid="cycle-speedometer-boost-chip"]').textContent).toBe('Hot ×2');
    expect(hot.querySelector('[data-testid="cycle-speedometer-boost-next"]')).toBeNull(); // top zone
    expect(hot.querySelector('[data-testid="cycle-speedometer-boost-bar"]')).toBeNull(); // no progress
    const warm = boostOf(view, 1);
    expect(warm.querySelector('[data-testid="cycle-speedometer-boost-chip"]').textContent).toBe('Warm ×1.5');
    expect(warm.querySelector('[data-testid="cycle-speedometer-boost-next"]').textContent).toBe('Hot ×2');
    expect(warm.querySelector('[data-testid="cycle-speedometer-boost-fill"]').style.width).toBe('50%');
  });

  it('a rider with no heart rate reads "No heart-rate strap ×0.8" on the gauge', () => {
    vitals.user_2 = { name: 'User_2', heartRate: null, zoneId: null };
    mockCtx = makeCtx();
    const view = render(<CycleGameContainer />);
    startDistanceRace(view);
    toRacing();
    tick(1);
    expect(boostOf(view, 1).querySelector('[data-testid="cycle-speedometer-boost-chip"]').textContent)
      .toBe('No heart-rate strap ×0.8');
  });

  it('the ready strip shows the strapless handicap under a rider with no heart rate', () => {
    vitals.user_2 = { name: 'User_2', heartRate: null, zoneId: null };
    mockCtx = makeCtx();
    const view = render(<CycleGameContainer />);
    startDistanceRace(view);
    toCountdown();
    expect(view.getByTestId('ready-rider-user_2').textContent).toContain('No strap · ×0.8');
    expect(view.getByTestId('ready-rider-user_1').textContent).not.toContain('No strap');
  });

  it('a zone going up raises one boost toast; going down does not; both are logged; the first reading is not', () => {
    mockCtx = makeCtx();
    const view = render(<CycleGameContainer />);
    startDistanceRace(view);
    toRacing();
    tick(2);
    expect(logsOf('debug', 'cycle_game.boost_change')).toEqual([]);
    expect(toastText(view)).not.toMatch(/×/);
    // user_2 warms up: warm → hot.
    vitals.user_2 = { ...vitals.user_2, zoneId: 'hot', zoneColor: 'orange' };
    tick(1);
    const toast = view.getByTestId('cycle-event-toast');
    expect(toast.getAttribute('data-variant')).toBe('boost');
    expect(toast.textContent).toContain('User_2: Hot ×2');
    const up = logsOf('debug', 'cycle_game.boost_change');
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ userId: 'user_2', from: 'warm', to: 'hot', mult: 2, elapsedS: expect.any(Number) });
    expect(up[0].raceId).toMatch(/^\d{14}$/);
    // Let it clear, then cool down: hot → warm. Logged, no toast.
    act(() => { vi.advanceTimersByTime(5000); });
    vitals.user_2 = { ...vitals.user_2, zoneId: 'warm', zoneColor: 'yellow' };
    tick(1);
    expect(view.queryByTestId('cycle-event-toast')).toBeNull();
    const all = logsOf('debug', 'cycle_game.boost_change');
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ userId: 'user_2', from: 'hot', to: 'warm', mult: 1.5 });
  });
});
