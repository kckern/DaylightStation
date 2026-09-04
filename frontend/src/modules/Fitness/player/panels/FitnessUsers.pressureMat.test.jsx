import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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
});
