import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// Parked and no-sensor riders on the race screen: nobody is eliminated. A rider
// idle past the park window is parked (dimmed, out of the framing) and comes
// back on their next stroke; a rider whose sensor never reported reads NO SIGNAL.
//
// ── mocks (mirrors CycleGameContainer.raceMenu.test.jsx) ──────────────────
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy })
}));

let mockCtx;
vi.mock("../../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => mockCtx
}));

vi.mock("../../nav/usePersistentVolume.js", () => ({
  usePersistentVolume: () => ({ volume: 1, muted: false, source: 'exact', setVolume: vi.fn(), toggleMute: vi.fn() })
}));

import CycleGameContainer from "./CycleGameContainer.jsx";

const RACE_TICK_MS = 1000;
const GO_HOLD_MS = 800;
const START_COUNTDOWN_S = 3;

// Per-bike cadence and sensor state the tests can change mid-race.
let rpmByBike;
let connectedByBike;

function makeCtx(cycleGameConfig = {}) {
  const riders = { cycle_ace: 'user_1', tricycle: 'user_2' };
  const vitals = {
    user_1: { name: 'User_1', heartRate: 140, zoneId: 'hot', zoneColor: 'orange' },
    user_2: { name: 'User_2', heartRate: 120, zoneId: 'warm', zoneColor: 'yellow' }
  };
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
      hrless_multiplier: 1.0,
      start_countdown_s: START_COUNTDOWN_S,
      staging_buffer_ms: 0, // straight to countdown unless a test asks for staging
      cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }],
      ...cycleGameConfig
    },
    fitnessSessionInstance: {
      getEquipmentRider: (id) => riders[id] || null,
      getEquipmentCadence: (id) => ({ rpm: rpmByBike[id] ?? 100, connected: connectedByBike[id] ?? true })
    },
    getUserVitals: (id) => vitals[id] || null,
    getDisplayName: (id) => id,
    getUserByName: (id) => ({ name: vitals[id]?.name || id }),
    setGovernanceSuspended: vi.fn()
  };
}

const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

// Answers the lobby's mount-time reads and the save POST. `ladder` is the
// /ladder body (default 404: no featured course); `ladderAfter` replaces it
// once a race has been saved; `byId` answers single-race reads.
function makeFetch({ ladder = null, ladderAfter = null, byId = {} } = {}) {
  let saved = false;
  return vi.fn((url, opts) => {
    const u = String(url);
    if (opts && opts.method === 'POST') { saved = true; return json({}); }
    if (u.includes('/ladder')) {
      const body = saved && ladderAfter ? ladderAfter : ladder;
      return body ? json(body) : Promise.resolve({ ok: false, status: 404 });
    }
    if (u.includes('/personal-bests')) return json({ best: null });
    if (u.includes('/rival-pool')) return json({ entries: [] });
    const one = u.match(/\/cycle-races\/(\d+)$/);
    if (one) return byId[one[1]] ? json({ race: byId[one[1]] }) : Promise.resolve({ ok: false, status: 404 });
    return json({ dates: [] });
  });
}

const logsOf = (level, event) => logSpy[level].mock.calls.filter(([e]) => e === event).map(([, d]) => d);

describe('CycleGameContainer — parked riders on screen', () => {
  let nowMs;

  beforeEach(() => {
    rpmByBike = {};
    connectedByBike = {};
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
    // A bike that reads silent makes the lobby warn first: start anyway.
    const anyway = view.queryByTestId('sensor-warning-start');
    if (anyway) act(() => { fireEvent.click(anyway); });
  };
  // Countdown, green-light hold, then the first race tick.
  const toRacing = () => {
    act(() => { vi.advanceTimersByTime(1000 * START_COUNTDOWN_S); });
    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
    nowMs = 1000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
  };
  // One race tick per act, so every tick renders.
  const tick = (n = 1) => {
    for (let i = 0; i < n; i += 1) {
      nowMs += RACE_TICK_MS;
      act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });
    }
  };
  const speedoOf = (view, i) => view.getAllByTestId('cycle-speedometer-rpm')[i].closest('.cycle-speedometer');
  const towerRow = (view, id) => view.getAllByTestId('tower-row').find((r) => r.dataset.rider === id);
  const toastText = (view) => view.queryByTestId('cycle-event-toast')?.textContent || '';

  it('a rider idling past the park window is shown PARKED: speedometer, tower, toast and rider_parked', () => {
    mockCtx = makeCtx({ race_idle_dnf_s: 3 });
    const view = render(<CycleGameContainer />);
    startDistanceRace(view);
    toRacing();
    tick(1);
    rpmByBike.tricycle = 0;
    tick(3);
    // user_2 rides the tricycle (second rider, second gauge).
    const overlay = view.getByTestId('cycle-speedometer-parked');
    expect(overlay.textContent).toContain('PARKED');
    expect(overlay.textContent).toContain('Pedal to rejoin');
    expect(speedoOf(view, 1).querySelector('[data-testid="cycle-speedometer-parked"]')).toBe(overlay);
    const row = towerRow(view, 'user_2');
    expect(row.dataset.kind).toBe('parked');
    expect(row.querySelector('[data-testid="tower-metric"]').textContent).toMatch(/^Parked · \d+ m$/);
    expect(toastText(view)).toContain('User_2 is parked');
    expect(toastText(view)).toContain('Pedal to rejoin');
    expect(view.getByTestId('cycle-event-toast').getAttribute('data-variant')).toBe('parked');
    const parkedLogs = logsOf('info', 'cycle_game.rider_parked');
    expect(parkedLogs).toHaveLength(1);
    expect(parkedLogs[0]).toMatchObject({ userId: 'user_2', elapsedS: expect.any(Number), distanceM: expect.any(Number) });
    expect(parkedLogs[0].raceId).toMatch(/^\d{14}$/);
    expect(parkedLogs[0].distanceM).toBeGreaterThan(0);
    // One toast, not one per tick.
    tick(2);
    expect(logsOf('info', 'cycle_game.rider_parked')).toHaveLength(1);
    // Nobody is eliminated, and nothing on screen says so.
    expect(view.getByTestId('cycle-race-screen').textContent).not.toMatch(/DNF|Did Not Finish/);
    expect(logsOf('info', 'cycle_game.rider_dnf')).toEqual([]);
  });

  it('pedalling again removes the overlay, the tower row and logs rider_resumed with the time away', () => {
    mockCtx = makeCtx({ race_idle_dnf_s: 3 });
    const view = render(<CycleGameContainer />);
    startDistanceRace(view);
    toRacing();
    tick(1);
    rpmByBike.tricycle = 0;
    tick(3);
    expect(view.getByTestId('cycle-speedometer-parked')).toBeTruthy();
    const parkedAt = logsOf('info', 'cycle_game.rider_parked')[0].elapsedS;
    tick(4);
    // Let the parked toast run out so the screen is checked clean.
    act(() => { vi.advanceTimersByTime(5000); });
    rpmByBike.tricycle = 90;
    tick(1); // the tick they pedal
    expect(view.queryByTestId('cycle-speedometer-parked')).toBeNull();
    expect(towerRow(view, 'user_2').dataset.kind).toBe('active');
    expect(view.getByTestId('cycle-race-screen').textContent).not.toContain('Parked');
    const resumed = logsOf('info', 'cycle_game.rider_resumed');
    expect(resumed).toHaveLength(1);
    expect(resumed[0]).toMatchObject({ userId: 'user_2', distanceM: expect.any(Number) });
    expect(resumed[0].awayS).toBe(resumed[0].elapsedS - parkedAt);
    expect(resumed[0].awayS).toBeGreaterThan(0);
    // No toast on resume.
    expect(toastText(view)).not.toMatch(/User_2/);
  });

  it('a rider whose sensor never reported reads NO SIGNAL, not parked, and recovery is logged', () => {
    mockCtx = makeCtx({ race_start_grace_s: 3 });
    connectedByBike.tricycle = false;
    const view = render(<CycleGameContainer />);
    startDistanceRace(view);
    toRacing();
    tick(4);
    const overlay = view.getByTestId('cycle-speedometer-parked');
    expect(overlay.textContent).toContain('NO SIGNAL');
    expect(overlay.textContent).toContain('Check the sensor');
    expect(overlay.textContent).not.toContain('PARKED');
    const metric = towerRow(view, 'user_2').querySelector('[data-testid="tower-metric"]').textContent;
    expect(metric).toBe('No signal · 0 m');
    expect(view.getByTestId('cycle-race-screen').textContent).not.toContain('Parked');
    expect(logsOf('info', 'cycle_game.rider_parked')).toEqual([]);
    expect(logsOf('warn', 'cycle_game.rider_no_sensor').map((d) => d.userId)).toEqual(['user_2']);
    expect(view.getByTestId('cycle-event-toast').getAttribute('data-variant')).toBe('nosensor');
    // The sensor wakes up and they are moving.
    connectedByBike.tricycle = true;
    rpmByBike.tricycle = 80;
    tick(1);
    expect(view.queryByTestId('cycle-speedometer-parked')).toBeNull();
    const recovered = logsOf('info', 'cycle_game.rider_sensor_recovered');
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ userId: 'user_2' });
  });

  it('a parked rider who is ahead on distance is never announced as taking the lead', () => {
    // user_1 waits, then sprints past user_2 and stops at once: parked while
    // still ahead, before the challenger hold (3 s) could announce them.
    mockCtx = makeCtx({ race_idle_dnf_s: 1 });
    rpmByBike.cycle_ace = 0;
    const view = render(<CycleGameContainer />);
    startDistanceRace(view);
    toRacing();          // t1
    tick(1);             // t2
    rpmByBike.cycle_ace = 300;
    tick(2);             // t3, t4: user_1 ahead by a wide margin
    rpmByBike.cycle_ace = 0;
    tick(6);             // t5..t10: user_1 parked, still ahead on distance
    const lastTick = logsOf('debug', 'cycle_game.tick').slice(-1)[0].riders;
    const dist = Object.fromEntries(lastTick.map((r) => [r.userId, r.distanceM]));
    expect(dist.user_1).toBeGreaterThan(dist.user_2); // technically ahead
    expect(logsOf('info', 'cycle_game.rider_parked').map((d) => d.userId)).toContain('user_1');
    const leadChanges = logsOf('debug', 'cycle_game.drama_event').filter((e) => e.type === 'LEAD_CHANGE');
    expect(leadChanges.flatMap((e) => e.riderIds)).not.toContain('user_1');
    expect(toastText(view)).not.toContain('User_1 takes the lead');
  });

  it('the results board shows a rider stopped at the close as "Stopped at …", never DNF', async () => {
    mockCtx = makeCtx({ race_idle_dnf_s: 3 });
    const view = render(<CycleGameContainer />);
    act(() => { fireEvent.click(view.getByTestId('course-distance')); });
    act(() => { fireEvent.click(view.getByTestId('tier-flash')); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    toRacing();
    tick(1);
    rpmByBike.tricycle = 0;
    for (let i = 0; i < 60 && !view.queryByTestId('race-results'); i += 1) {
      nowMs += RACE_TICK_MS;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await vi.advanceTimersByTimeAsync(RACE_TICK_MS); });
    }
    const results = view.getByTestId('race-results');
    expect(view.getByTestId('result-row-user_2').textContent).toMatch(/Stopped at \d+ m/);
    expect(results.textContent).not.toMatch(/DNF|Did Not Finish|False start/);
  });
});
