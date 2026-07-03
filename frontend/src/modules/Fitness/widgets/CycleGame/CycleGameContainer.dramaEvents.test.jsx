import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// ── mocks (mirrors CycleGameContainer.wallclock.test.jsx) ─────────────────
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

const RACE_TICK_MS = 1000;
const COUNTDOWN_TICK_MS = 1000;
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
      staging_buffer_ms: 0,
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

// Drama events (audit C2) — deriveRaceSnapshot was fully built + unit-tested
// but never called from the live race tick until now. dramaEventCopy.test.js
// covers the pure event→copy mapping in isolation; these tests prove the
// wiring itself: real race ticks actually produce toasts on screen.
describe('CycleGameContainer — drama events wired into the live tick (audit C2)', () => {
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

  it('raises a LEAD_CHANGE toast the instant the trailing rider overtakes', () => {
    let phase = 1; // 1: kckern ahead · 2: felix overtakes
    mockCtx = makeCtx({
      fitnessSessionInstance: {
        getEquipmentRider: (id) => ({ cycle_ace: 'kckern', tricycle: 'felix' })[id] || null,
        getEquipmentCadence: (id) => {
          if (id === 'cycle_ace') return { rpm: phase === 1 ? 120 : 5, connected: true };
          return { rpm: phase === 1 ? 5 : 150, connected: true };
        }
      }
    });
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    driveToGo(renderApi);

    // Phase 1: kckern rides hard, felix crawls — kckern takes an early lead.
    nowMs = 4000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    // Phase 2: felix surges, kckern nearly stops — felix overtakes within a
    // handful of ticks.
    phase = 2;
    nowMs = 4000 + 16000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    const toast = renderApi.getByTestId('cycle-event-toast');
    expect(toast.dataset.variant).toBe('lead-change');
    expect(toast.textContent).toContain('Felix takes the lead!');
  });

  it('raises a RIDER_FINISHED ceremony toast the instant a rider crosses the goal — while the race is still live', () => {
    // 100 m "Flash" tier: kckern rides hard and crosses first; felix rides at
    // a real (non-zero, non-idle) pace the whole time, so the race is still
    // actively 'racing' — not yet at the results screen — when kckern's
    // ceremony toast fires.
    mockCtx = makeCtx({
      fitnessSessionInstance: {
        getEquipmentRider: (id) => ({ cycle_ace: 'kckern', tricycle: 'felix' })[id] || null,
        getEquipmentCadence: (id) => (id === 'cycle_ace' ? { rpm: 120, connected: true } : { rpm: 20, connected: true })
      }
    });
    const renderApi = render(<CycleGameContainer />);
    nowMs = 0;
    act(() => { fireEvent.click(renderApi.getByTestId('course-distance')); });
    act(() => { fireEvent.click(renderApi.getByTestId('tier-flash')); }); // 100 m goal — fast to resolve
    act(() => { fireEvent.click(renderApi.getByTestId('cycle-game-start')); });
    act(() => { vi.advanceTimersByTime(COUNTDOWN_TICK_MS * START_COUNTDOWN_S); });

    // ~15 ticks is enough for kckern to cross 100 m at rpm 120 (mirrors the
    // wallclock mercy-kill fixture's own timing note).
    nowMs = 16000;
    act(() => { vi.advanceTimersByTime(RACE_TICK_MS); });

    const toast = renderApi.getByTestId('cycle-event-toast');
    expect(toast.dataset.variant).toBe('finished');
    expect(toast.textContent).toContain('KC finishes 1st!');
    expect(toast.textContent).toContain('Crosses the line first');

    // The whole point of a mid-race ceremony: the race screen is still live,
    // this is NOT the end-of-race results screen.
    expect(renderApi.getByTestId('cycle-race-screen')).toBeTruthy();
    expect(renderApi.queryByTestId('race-results')).toBeNull();
  });
});
