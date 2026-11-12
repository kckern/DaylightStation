import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

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
import { discardRace } from "./raceMenuTestHelpers.js";

function makeCtx(overrides = {}) {
  const riders = { cycle_ace: 'user_1', tricycle: 'user_2' };
  const vitals = {
    user_1: { name: 'Rider A', heartRate: 140, zoneId: 'hot', zoneColor: 'orange' },
    user_2: { name: 'User_2', heartRate: 120, zoneId: 'warm', zoneColor: 'yellow' }
  };
  return {
    equipment: [
      { id: 'cycle_ace', name: 'CycleAce', cadence: 49904, wheel_circumference_m: 2.1, eligible_users: ['user_1'] },
      { id: 'tricycle', name: 'Tricycle', cadence: 7153, wheel_circumference_m: 1.2 }
    ],
    configuredUsers: [{ id: 'user_1', name: 'Rider A' }, { id: 'user_2', name: 'User_2' }],
    zones: [
      { id: 'warm', distance_multiplier: 1.5, color: 'yellow' },
      { id: 'hot', distance_multiplier: 2, color: 'orange' }
    ],
    cycleGameConfig: {
      default_win_condition: 'distance',
      distance_goal_default_m: 3000,
      start_countdown_s: 3,
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
    setImmersive: vi.fn(),
    ...overrides
  };
}

describe('CycleGameContainer: the app navigation rail', () => {
  beforeEach(() => {
    mockCtx = makeCtx();
    Object.values(logSpy).forEach((fn) => fn.mockClear());
    global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
  });

  const start = (view) => {
    act(() => { fireEvent.click(view.getByTestId('course-distance')); });
    act(() => { fireEvent.click(view.getByTestId('cycle-game-start')); });
  };

  it('keeps the rail in the lobby', () => {
    render(<CycleGameContainer />);
    expect(mockCtx.setImmersive).not.toHaveBeenCalledWith(true);
  });

  it('hides the rail when the race leaves the lobby and logs the change', () => {
    const view = render(<CycleGameContainer />);
    start(view);
    expect(mockCtx.setImmersive).toHaveBeenLastCalledWith(true);
    expect(logSpy.debug).toHaveBeenCalledWith('cycle_game.immersive', { on: true });
  });

  it('brings the rail back when the race is discarded to the lobby', () => {
    const view = render(<CycleGameContainer />);
    start(view);
    discardRace(view);
    expect(view.getByTestId('cycle-game-home')).toBeTruthy();
    expect(mockCtx.setImmersive).toHaveBeenLastCalledWith(false);
    expect(logSpy.debug).toHaveBeenCalledWith('cycle_game.immersive', { on: false });
  });

  it('brings the rail back when the game unmounts mid-race', () => {
    const view = render(<CycleGameContainer />);
    start(view);
    mockCtx.setImmersive.mockClear();
    act(() => { view.unmount(); });
    expect(mockCtx.setImmersive).toHaveBeenCalledWith(false);
  });

  it('works in a host that offers no setImmersive', () => {
    mockCtx = makeCtx({ setImmersive: undefined });
    const view = render(<CycleGameContainer />);
    expect(() => start(view)).not.toThrow();
  });
});
