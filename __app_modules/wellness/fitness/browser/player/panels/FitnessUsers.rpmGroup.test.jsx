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

const bikes = (n) => Array.from({ length: n }, (_, i) => ({ deviceId: String(1000 + i), cadence: 40 + i, type: 'cadence', isActive: true, lastSeen: Date.now() }));

describe('FitnessUsers RPM group', () => {
  it.each([1, 2, 3, 4, 5])('lays out %i bikes with one fixed-size wrapping group, never a shrink transform', async (n) => {
    testState.context = { ...baseContext({}), rpmDevices: bikes(n) };
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelectorAll('.rpm-device-avatar').length).toBe(n));
    const group = container.querySelector('.rpm-group-container');
    expect(group.style.transform || '').not.toMatch(/scale/);
    const grid = container.querySelector('.rpm-devices');
    expect(grid.className).not.toMatch(/devicecount/);
  });
});
