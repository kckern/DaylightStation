import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const testState = vi.hoisted(() => ({ context: null }));

vi.mock('@/context/FitnessContext.jsx', () => ({
  useFitnessContext: () => testState.context,
}));

vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import FitnessUsersList from './FitnessUsers.jsx';

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
      mat: { equipmentId: 'mat', matId: 'mat', seenThisSession: true, online: true, active: true, engaged: true, sessionSteps: 1, sessionStomps: 0, stepsPerMinute: 4 },
    } };
    rerender(<FitnessUsersList />);
    await waitFor(() => expect(screen.getByRole('button', { name: /step mat:/i })).toBeTruthy());
    expect(container.querySelector('.step-mat-list-item')).toBeTruthy();
    testState.context = { ...testState.context, pressureMatActivities: {} };
    rerender(<FitnessUsersList />);
    // Finish the leave transition in jsdom, which has no browser animation clock.
    await waitFor(() => expect(container.querySelector('.step-mat-list-item')?.style.opacity).toBe('0'));
    fireEvent.transitionEnd(container.querySelector('.step-mat-list-item'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /step mat:/i })).toBeNull());
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/stateless|cannot be given refs/i);
  });
});
