import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const testState = vi.hoisted(() => ({ context: null }));

vi.mock("../../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => testState.context,
}));

vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

// The zone badge is a Mantine Badge; this test is about our start badge.
vi.mock('@mantine/core', () => ({ Badge: ({ children }) => <span>{children}</span> }));

import FitnessUsersList from "./FitnessUsers.jsx";

const governed = {
  isGoverned: true,
  challenge: null,
  unattendedStart: {
    zone: 'hot', zoneLabel: 'Hot',
    children: { 'child-a': { started: false, overdue: true, remainingMs: 0 } },
  },
};

const hrDevice = { deviceId: '101', type: 'heart_rate', heartRate: 120, isActive: true, lastSeen: Date.now() };

const context = () => ({
  connected: true,
  fitnessDevices: new Map(),
  allDevices: [hrDevice],
  activeHeartRateParticipants: [hrDevice],
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
  pressureMatActivities: {},
  getUserByDevice: () => ({ id: 'child-a', name: 'Child A' }),
  getDisplayName: () => ({ displayName: 'Child A', source: 'profile' }),
  fitnessSessionInstance: { getEquipmentUser: () => null },
  governanceState: governed,
});

describe('FitnessUsers roster start badge', () => {
  it('keeps startup policy out of roster cards', async () => {
    testState.context = context();
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.device-name')).not.toBeNull());
    expect(container.querySelector('.device-start-badge')).toBeNull();
    expect(container.textContent).not.toMatch(/Reach Hot|Holding/);
  });

  it('shows no badge when the player passes a bypassed snapshot', async () => {
    testState.context = context();
    const bypassed = { ...governed, isGoverned: false, challenge: null };
    const { container } = render(<FitnessUsersList governanceStateOverride={bypassed} />);
    await waitFor(() => expect(container.querySelector('.device-name')).not.toBeNull());
    expect(container.querySelector('.governance-start-badge')).toBeNull();
  });
});
