import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// Toasts never arrive late: one slot, a queue that drops what has gone stale
// (milestones excepted), a newer toast of the same kind replaces a queued one,
// and a park notice is withdrawn when the rider resumes before it is shown.
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
const TOAST_EXIT_MS = 280;

let rpmByBike;
let vitals;

function makeCtx(cycleGameConfig = {}) {
  const riders = { cycle_ace: 'user_1', tricycle: 'user_2', trainer: 'user_3' };
  return {
    equipment: [
      { id: 'cycle_ace', name: 'CycleAce', cadence: 49904, wheel_circumference_m: 2.1 },
      { id: 'tricycle', name: 'Tricycle', cadence: 7153, wheel_circumference_m: 1.2 },
      { id: 'trainer', name: 'Trainer', cadence: 7154, wheel_circumference_m: 2.1 }
    ],
    zones: [
      { id: 'warm', distance_multiplier: 1.5, color: 'yellow' },
      { id: 'hot', distance_multiplier: 2, color: 'orange' },
      { id: 'fire', distance_multiplier: 3, color: 'red' }
    ],
    cycleGameConfig: {
      default_win_condition: 'distance',
      distance_goal_default_m: 3000,
      time_cap_default_s: 300,
      hrless_multiplier: 1.0,
      start_countdown_s: START_COUNTDOWN_S,
      staging_buffer_ms: 0,
      race_idle_dnf_s: 2,
      cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }],
      ...cycleGameConfig
    },
    fitnessSessionInstance: {
      getEquipmentRider: (id) => riders[id] || null,
      getEquipmentCadence: (id) => ({ rpm: rpmByBike[id] ?? 90, connected: true })
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
    if (u.includes('/rival-pool')) return json({ entries: [] });
    return json({ dates: [] });
  });
}

const logsOf = (level, event) => logSpy[level].mock.calls.filter(([e]) => e === event).map(([, d]) => d);
const shownVariants = () => logsOf('info', 'cycle_game.event_toast.shown').map((d) => d.variant);

describe('CycleGameContainer — toasts never arrive late', () => {
  let nowMs;

  beforeEach(() => {
    rpmByBike = {};
    vitals = {
      user_1: { name: 'User_1', heartRate: 120, zoneId: 'warm', zoneColor: 'yellow' },
      user_2: { name: 'User_2', heartRate: 120, zoneId: 'warm', zoneColor: 'yellow' },
      user_3: { name: 'User_3', heartRate: 120, zoneId: 'warm', zoneColor: 'yellow' }
    };
    Object.values(logSpy).forEach((fn) => fn.mockClear());
    mockCtx = makeCtx();
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

  const start = (view, type = 'time', tier = null) => {
    act(() => { fireEvent.click(view.getByTestId(`course-${type}`)); });
    if (tier) act(() => { fireEvent.click(view.getByTestId(`tier-${tier}`)); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const anyway = view.queryByTestId('sensor-warning-start');
    if (anyway) act(() => { fireEvent.click(anyway); });
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
  // Several race ticks in ONE timer fire (the wall-clock catch-up): every event
  // they raise is queued at the same instant.
  const burst = (n) => {
    nowMs += n * RACE_TICK_MS;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
  };
  const toast = (view) => view.queryByTestId('cycle-event-toast');
  // Let the toast on screen run out (3 s + exit) without running a race tick
  // past what the test means to (performance.now is frozen meanwhile).
  const clearToast = (ms = 3000) => { act(() => { vi.advanceTimersByTime(ms + TOAST_EXIT_MS); }); };

  it('a burst of same-kind toasts shows the first, then only the newest', () => {
    const view = render(<CycleGameContainer />);
    start(view);
    tick(1);
    vitals.user_1 = { ...vitals.user_1, zoneId: 'hot' };
    tick(1); // boost: User_1 → shown
    vitals.user_2 = { ...vitals.user_2, zoneId: 'hot' };
    tick(1); // boost: User_2 → queued
    vitals.user_1 = { ...vitals.user_1, zoneId: 'fire' };
    tick(1); // boost: User_1 again → replaces User_2's
    expect(toast(view).textContent).toContain('User_1: Hot');
    // 3 s on screen, from the tick it appeared (two ticks ago).
    clearToast(1000);
    expect(toast(view).textContent).toContain('User_1: Fire');
    clearToast();
    expect(toast(view)).toBeNull();
    expect(shownVariants()).toEqual(['boost', 'boost']);
    expect(logsOf('debug', 'cycle_game.event_toast.dropped'))
      .toEqual([expect.objectContaining({ variant: 'boost', reason: 'replaced', ageMs: expect.any(Number) })]);
  });

  it('each toast stays up for its own duration: 3 s for news', () => {
    const view = render(<CycleGameContainer />);
    start(view);
    tick(1);
    vitals.user_1 = { ...vitals.user_1, zoneId: 'hot' };
    tick(1);
    expect(toast(view)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(3000 + TOAST_EXIT_MS - 1); });
    expect(toast(view)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(toast(view)).toBeNull();
  });

  it('a toast that waited past the age limit is dropped and never rendered', () => {
    const view = render(<CycleGameContainer />);
    start(view);
    rpmByBike.cycle_ace = 120;
    rpmByBike.tricycle = 20;
    tick(3); // user_1 leads
    // One fire: user_1 boosts on its first tick (shown), user_3 parks two ticks
    // later and user_2 takes the lead after that (both queued, same instant).
    vitals.user_1 = { ...vitals.user_1, zoneId: 'hot' };
    rpmByBike.cycle_ace = 10;
    rpmByBike.tricycle = 400;
    rpmByBike.trainer = 0;
    burst(12);
    expect(toast(view).dataset.variant).toBe('boost');
    clearToast();
    expect(toast(view).dataset.variant).toBe('parked');
    clearToast();
    // The lead change waited 6.56 s: stale.
    expect(toast(view)).toBeNull();
    expect(shownVariants()).toEqual(['boost', 'parked']);
    const dropped = logsOf('debug', 'cycle_game.event_toast.dropped');
    expect(dropped).toEqual([expect.objectContaining({ variant: 'lead-change', reason: 'stale' })]);
    expect(dropped[0].ageMs).toBeGreaterThan(6000);
  });

  it('a finished toast queued behind others still shows, however late', () => {
    const view = render(<CycleGameContainer />);
    start(view, 'distance', 'flash'); // 100 m
    rpmByBike.tricycle = 20;
    tick(1);
    // One fire: user_2 boosts (shown), user_3 parks (queued), user_1 crosses
    // the line (queued behind the park notice). user_2 is still riding, so the
    // race stays live.
    vitals.user_2 = { ...vitals.user_2, zoneId: 'hot' };
    rpmByBike.cycle_ace = 120;
    rpmByBike.trainer = 0;
    burst(20);
    expect(logsOf('debug', 'cycle_game.drama_event').some((e) => e.type === 'RIDER_FINISHED')).toBe(true);
    expect(toast(view).dataset.variant).toBe('boost');
    clearToast();
    expect(toast(view).dataset.variant).toBe('parked');
    clearToast();
    // Waited 6.56 s and is still shown: a milestone is never dropped.
    expect(toast(view).dataset.variant).toBe('finished');
    expect(toast(view).textContent).toContain('finishes 1st');
  });

  it('a queued park notice is withdrawn when the rider resumes before it is shown', () => {
    const view = render(<CycleGameContainer />);
    start(view);
    tick(1);
    rpmByBike.tricycle = 0;
    vitals.user_1 = { ...vitals.user_1, zoneId: 'hot' };
    tick(1); // boost shown; user_2 idle 1 s
    tick(1); // user_2 parked → queued behind the boost
    expect(logsOf('info', 'cycle_game.rider_parked').map((d) => d.userId)).toEqual(['user_2']);
    rpmByBike.tricycle = 90;
    tick(1); // resumed
    clearToast(1000);
    expect(toast(view)).toBeNull();
    expect(shownVariants()).toEqual(['boost']);
    expect(logsOf('debug', 'cycle_game.event_toast.dropped'))
      .toEqual([expect.objectContaining({ variant: 'parked', reason: 'resolved' })]);
  });
});
