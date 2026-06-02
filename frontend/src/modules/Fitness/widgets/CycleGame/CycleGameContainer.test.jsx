import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';

// ── mocks ────────────────────────────────────────────────────────────────
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({
  default: () => ({ child: () => logSpy })
}));

let mockCtx;
vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => mockCtx
}));

import CycleGameContainer from './CycleGameContainer.jsx';

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
      start_countdown_s: 3,
      cadence_zones: [{ id: 'cruising', name: 'Cruising', min: 40, color: '#2ecc71' }]
    },
    fitnessSessionInstance: {
      getEquipmentRider: (id) => riders[id] || null,
      getEquipmentCadence: () => ({ rpm: 100, connected: true })
    },
    getUserVitals: (id) => vitals[id] || null,
    getDisplayName: (id) => id,
    getUserByName: (id) => ({ name: vitals[id]?.name || id }),
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
      expect.objectContaining({ courseId: 'distance', winCondition: 'distance', riders: ['kckern', 'felix'] })
    );
  });
});
