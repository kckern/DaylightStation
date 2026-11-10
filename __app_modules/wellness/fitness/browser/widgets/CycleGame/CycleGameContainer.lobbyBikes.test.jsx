import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

// The lobby's bike list as the container hands it to CycleGameHome. The lobby
// component is replaced by a probe so this file asserts on the data, not on how
// the lobby draws it.
const logSpy = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('@/lib/logging/Logger.js', () => ({ default: () => ({ child: () => logSpy }) }));

let mockCtx;
vi.mock('../../context/FitnessContext.jsx', () => ({ useFitnessContext: () => mockCtx }));
vi.mock('../../nav/usePersistentVolume.js', () => ({
  usePersistentVolume: () => ({ volume: 1, muted: false, setVolume: vi.fn(), toggleMute: vi.fn() })
}));

let lastHomeProps = null;
vi.mock('./CycleGameHome.jsx', () => ({
  default: (props) => { lastHomeProps = props; return <div data-testid="cycle-game-home" />; }
}));

import CycleGameContainer from './CycleGameContainer.jsx';

function ctxWithCadence(cadenceById) {
  return {
    equipment: [
      { id: 'bike_a', name: 'Bike A', cadence: 1, wheel_circumference_m: 2.1 },
      { id: 'bike_b', name: 'Bike B', cadence: 2, wheel_circumference_m: 1.2 },
      { id: 'bike_c', name: 'Bike C', cadence: 3, wheel_circumference_m: 1.2 }
    ],
    configuredUsers: [],
    zones: [],
    cycleGameConfig: { staging_buffer_ms: 0 },
    fitnessSessionInstance: {
      getEquipmentRider: () => null,
      getEquipmentCadence: (id) => cadenceById[id]
    },
    getUserVitals: () => null,
    getDisplayName: (id) => id,
    getUserByName: (id) => ({ name: id }),
    setGovernanceSuspended: vi.fn()
  };
}

describe('CycleGameContainer — lobby bikes', () => {
  beforeEach(() => {
    lastHomeProps = null;
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }));
  });

  it('marks each bike with whether its cadence sensor is reporting right now', () => {
    mockCtx = ctxWithCadence({
      bike_a: { rpm: 0, connected: true },   // reporting, standing still
      bike_b: { rpm: 0, connected: false },  // known silent
      bike_c: undefined                      // never seen
    });
    act(() => { render(<CycleGameContainer />); });
    const byId = Object.fromEntries(lastHomeProps.bikes.map((b) => [b.id, b]));
    expect(byId.bike_a.sensorLive).toBe(true);
    expect(byId.bike_b.sensorLive).toBe(false);
    expect(byId.bike_c.sensorLive).toBe(false);
  });
});
