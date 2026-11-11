import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const testState = vi.hoisted(() => ({ context: null }));

vi.mock("../../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => testState.context,
}));

vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import FitnessUsersList from "./FitnessUsers.jsx";

const baseContext = (pressureMatActivities) => ({
  connected: true,
  fitnessDevices: new Map(),
  allDevices: [],
  activeHeartRateParticipants: [],
  rpmDevices: [],
  equipmentDevices: [],
  deviceConfiguration: { hr: {}, cadence: {} },
  equipment: [],
  users: [],
  hrColorMap: {},
  zones: [],
  zoneProfiles: [],
  deviceAssignments: [],
  zoneProgressIndex: new Map(),
  userCollections: { all: [] },
  deviceOwnership: {},
  pressureMatActivities,
  getDisplayName: (deviceId) => ({ displayName: String(deviceId), source: 'fallback' }),
  fitnessSessionInstance: { getEquipmentUser: () => null },
});

afterEach(() => vi.restoreAllMocks());

describe('FitnessUsers pressure-mat composition', () => {
  it('mounts the step card for a discovered in-session mat without equipment config', async () => {
    testState.context = baseContext({
      'garage-step-mat': {
        equipmentId: 'garage-step-mat',
        matId: 'garage-step-mat',
        online: true,
        active: true,
        engaged: true,
        seenThisSession: true,
        lastSeenAt: Date.now(),
        lastActivityAt: Date.now(),
        stepsPerMinute: 36,
        sessionSteps: 9,
        sessionStomps: 7,
      },
    });

    render(<FitnessUsersList />);

    await waitFor(() => {
      expect(screen.getByLabelText(/step mat: 36 steps per minute, 9 steps, 7 stomps/i)).toBeTruthy();
    });
  });

  it('does not mount the step card before the first in-session step', async () => {
    testState.context = baseContext({
      'garage-step-mat': {
        equipmentId: 'garage-step-mat',
        matId: 'garage-step-mat',
        online: true,
        active: false,
        engaged: false,
        seenThisSession: false,
        lastSeenAt: Date.now(),
        stepsPerMinute: 0,
        sessionSteps: 0,
        sessionStomps: 0,
      },
    });

    render(<FitnessUsersList />);

    await waitFor(() => {
      expect(screen.queryByLabelText(/step mat:/i)).toBeNull();
      expect(screen.getByText('Ready for Users')).toBeTruthy();
    });
  });

  it('inserts beside an existing device and removes cleanly without animation ref warnings', async () => {
    const errors = vi.spyOn(console, 'error');
    testState.context = { ...baseContext({}), equipmentDevices: [{ deviceId: 'power-1', type: 'power', power: 50, lastSeen: Date.now(), isActive: true }] };
    const { rerender, container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-device.power')).toBeTruthy());
    testState.context = { ...testState.context, pressureMatActivities: {
      mat: { equipmentId: 'mat', matId: 'mat', seenThisSession: true, lastActivityAt: Date.now(), online: true, active: true, engaged: true, sessionSteps: 1, sessionStomps: 0, stepsPerMinute: 4 },
    } };
    rerender(<FitnessUsersList />);
    await waitFor(() => expect(screen.getByRole('button', { name: /step mat:/i })).toBeTruthy());
    expect(container.querySelector('.fitness-devices-pinned .step-mat-list-item')).toBeTruthy();
    expect(container.querySelector('.fitness-devices .step-mat-list-item')).toBeNull();
    testState.context = { ...testState.context, pressureMatActivities: {} };
    rerender(<FitnessUsersList />);
    // Step mats are pinned below the scrolling rider list (outside FlipMove),
    // so they leave at once rather than through a FLIP transition.
    await waitFor(() => expect(screen.queryByRole('button', { name: /step mat:/i })).toBeNull());
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/stateless|cannot be given refs/i);
  });

  const matAt = (lastActivityAt, extra = {}) => ({
    'garage-step-mat': {
      equipmentId: 'garage-step-mat', matId: 'garage-step-mat', online: true, active: false, engaged: true,
      seenThisSession: true, lastSeenAt: lastActivityAt, lastActivityAt, stepsPerMinute: 0,
      sessionSteps: 120, sessionStomps: 4, ...extra,
    },
  });

  it('hides the card once the mat has been quiet for 90 seconds', async () => {
    testState.context = baseContext(matAt(Date.now() - 91_000));
    render(<FitnessUsersList />);
    await waitFor(() => expect(screen.getByText('Ready for Users')).toBeTruthy());
    expect(screen.queryByLabelText(/step mat:/i)).toBeNull();
  });

  it('does not resurrect the card from a restored session with no live activity', async () => {
    testState.context = baseContext(matAt(null));
    render(<FitnessUsersList />);
    await waitFor(() => expect(screen.getByText('Ready for Users')).toBeTruthy());
    expect(screen.queryByLabelText(/step mat:/i)).toBeNull();
  });

  it('hides on the sidebar timeline tick with no new mat packet, and returns on the next step', async () => {
    const start = 1_800_000_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    const activities = matAt(start - 80_000);
    testState.context = { ...baseContext(activities), timelineTimebase: { tickCount: 10, intervalMs: 5000 } };
    const { rerender } = render(<FitnessUsersList />);
    await waitFor(() => expect(screen.getByLabelText(/step mat:/i)).toBeTruthy());

    // 15s later: same snapshot object (no packet), only the timeline ticked.
    now.mockReturnValue(start + 15_000);
    testState.context = { ...testState.context, timelineTimebase: { tickCount: 13, intervalMs: 5000 } };
    rerender(<FitnessUsersList />);
    await waitFor(() => expect(screen.queryByLabelText(/step mat:/i)).toBeNull());

    // Next step: a fresh snapshot brings the card back.
    testState.context = { ...testState.context, pressureMatActivities: matAt(start + 15_000, { stepsPerMinute: 4, sessionSteps: 121 }) };
    rerender(<FitnessUsersList />);
    await waitFor(() => expect(screen.getByLabelText(/step mat: 4 steps per minute, 121 steps/i)).toBeTruthy());
  });
});
