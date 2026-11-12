import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// Stale rider claims clear themselves: a bike claimed more than 30 minutes
// ago whose pedals have not turned since is unclaimed by the lobby, so the
// next session does not start by clearing a stranger off a bike. Never during
// a race or on the results board, and never a claim made in the last 30 min.
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
  usePersistentVolume: () => ({ volume: 1, muted: false, source: 'exact', setVolume: vi.fn(), toggleMute: vi.fn() })
}));

import CycleGameContainer from "./CycleGameContainer.jsx";

// "Race my best" is opt-in (2026-11-10): these tests are about the rival, so
// they switch it on first, the way a rider would in the lobby.
const optInRival = (v) => {
  const sw = v.queryByTestId('race-my-best');
  if (sw && sw.getAttribute('aria-checked') !== 'true') act(() => { fireEvent.click(sw); });
};

const MIN = 60 * 1000;
const START_COUNTDOWN_S = 3;
const GO_HOLD_MS = 800;

let rpmByBike;
let claims;

function makeCtx() {
  return {
    equipment: [
      { id: 'cycle_ace', name: 'CycleAce', cadence: 49904, wheel_circumference_m: 2.1 },
      { id: 'tricycle', name: 'Tricycle', cadence: 7153, wheel_circumference_m: 2.1 }
    ],
    zones: [{ id: 'warm', distance_multiplier: 1.5, color: 'yellow' }],
    cycleGameConfig: {
      start_countdown_s: START_COUNTDOWN_S,
      staging_buffer_ms: 0,
      time_cap_default_s: 300,
      cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }]
    },
    fitnessSessionInstance: {
      getEquipmentRider: (id) => claims[id] || null,
      setEquipmentRider: (id, userId) => { if (userId) claims[id] = userId; else delete claims[id]; },
      getEquipmentCadence: (id) => ({ rpm: rpmByBike[id] ?? 0, connected: true })
    },
    getUserVitals: () => null,
    getDisplayName: (id) => id,
    getUserByName: (id) => ({ name: id }),
    setGovernanceSuspended: vi.fn()
  };
}

const json = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const logsOf = (level, event) => logSpy[level].mock.calls.filter(([e]) => e === event).map(([, d]) => d);
const cleared = () => logsOf('info', 'cycle_game.rider_auto_cleared');

describe('CycleGameContainer — stale rider claims clear themselves', () => {
  let nowMs;

  beforeEach(() => {
    rpmByBike = {};
    claims = { cycle_ace: 'user_1' };
    mockCtx = makeCtx();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
    global.fetch = vi.fn((url, opts) => {
      const u = String(url);
      if (opts && opts.method === 'POST') return json({});
      if (u.includes('/ladder')) return Promise.resolve({ ok: false, status: 404 });
      return json({ dates: [] });
    });
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

  // Lobby time passes a minute per act (the idle polls render once per act).
  const idleFor = (minutes) => {
    for (let i = 0; i < minutes; i += 1) act(() => { vi.advanceTimersByTime(MIN); });
  };

  it('clears a claim idle for 31 minutes, through the unassign path, and logs it', () => {
    const view = render(<CycleGameContainer />);
    idleFor(31);
    expect(claims.cycle_ace).toBeUndefined();
    expect(cleared()).toEqual([{ equipmentId: 'cycle_ace', userId: 'user_1', idleMs: expect.any(Number) }]);
    expect(cleared()[0].idleMs).toBeGreaterThan(30 * MIN);
    expect(logsOf('info', 'cycle_game.rider_unassigned')).toEqual([
      expect.objectContaining({ equipmentId: 'cycle_ace', control: 'lobby.auto-clear' })
    ]);
    // The grid shows the bike free.
    expect(view.getByTestId('cycle-game-home')).toBeTruthy();
  });

  it('leaves a claim idle for 29 minutes', () => {
    render(<CycleGameContainer />);
    idleFor(29);
    expect(claims.cycle_ace).toBe('user_1');
    expect(cleared()).toEqual([]);
  });

  it('pedalling counts as activity: idle is measured from the last turn of the pedals', () => {
    render(<CycleGameContainer />);
    idleFor(20);
    rpmByBike.cycle_ace = 60;
    act(() => { vi.advanceTimersByTime(2000); });
    rpmByBike.cycle_ace = 0;
    idleFor(25); // 45 min since the claim, 25 since the pedals turned
    expect(claims.cycle_ace).toBe('user_1');
    idleFor(6);
    expect(claims.cycle_ace).toBeUndefined();
  });

  it('a fresh claim survives with no cadence while an old one beside it is cleared', () => {
    render(<CycleGameContainer />);
    idleFor(20);
    claims.tricycle = 'user_2'; // claimed outside the picker (rider-select button)
    idleFor(11);
    expect(claims.cycle_ace).toBeUndefined();
    expect(claims.tricycle).toBe('user_2');
    expect(cleared().map((c) => c.equipmentId)).toEqual(['cycle_ace']);
  });

  it('a bike that changes hands is a fresh claim', () => {
    render(<CycleGameContainer />);
    idleFor(29);
    claims.cycle_ace = 'user_2'; // someone else sits down
    idleFor(5);
    expect(claims.cycle_ace).toBe('user_2');
    expect(cleared()).toEqual([]);
  });

  it('never while a start is waiting on its rival lookup', () => {
    // A lone rider's Start waits on the server's rival pool, which never answers.
    global.fetch = vi.fn((url) => {
      const u = String(url);
      if (u.includes('/rival-pool')) return new Promise(() => {});
      if (u.includes('/ladder')) return Promise.resolve({ ok: false, status: 404 });
      return json({ dates: [] });
    });
    const view = render(<CycleGameContainer />);
    idleFor(30); // exactly 30 min idle: not yet stale
    act(() => { vi.advanceTimersByTime(59 * 1000); });
    act(() => { fireEvent.click(view.getByTestId('course-time')); });
    optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const anyway = view.queryByTestId('sensor-warning-start');
    if (anyway) act(() => { fireEvent.click(anyway); });
    expect(view.getByTestId('cycle-game-start').textContent).toContain('Starting');
    act(() => { vi.advanceTimersByTime(1000); }); // the 31-minute sweep, mid-lookup
    expect(claims.cycle_ace).toBe('user_1');
    expect(cleared()).toEqual([]);
  });

  it('never during a race or on the results board; on the way back to the lobby it is', async () => {
    claims = { cycle_ace: 'user_1', tricycle: 'user_2' };
    const view = render(<CycleGameContainer />);
    idleFor(29);
    act(() => { fireEvent.click(view.getByTestId('course-time')); });
    act(() => { fireEvent.click(view.getByTestId('tier-flash')); }); // 60 s
    optInRival(view); act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
    const anyway = view.queryByTestId('sensor-warning-start');
    if (anyway) act(() => { fireEvent.click(anyway); });
    act(() => { vi.advanceTimersByTime(1000 * START_COUNTDOWN_S); });
    act(() => { vi.advanceTimersByTime(GO_HOLD_MS); });
    // Nobody pedals: the race runs out with both riders away.
    for (let i = 0; i < 70 && !view.queryByTestId('race-results'); i += 1) {
      nowMs += 1000;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    }
    expect(view.getByTestId('race-results')).toBeTruthy();
    // Hold the board well past the 30-minute mark.
    act(() => { fireEvent.pointerDown(view.getByTestId('race-results')); });
    idleFor(5);
    expect(view.getByTestId('race-results')).toBeTruthy();
    expect(claims).toEqual({ cycle_ace: 'user_1', tricycle: 'user_2' });
    expect(cleared()).toEqual([]);
    act(() => { fireEvent.click(view.getByTestId('race-results-exit')); });
    expect(claims).toEqual({});
    expect(cleared().map((c) => c.equipmentId).sort()).toEqual(['cycle_ace', 'tricycle']);
  });
});
