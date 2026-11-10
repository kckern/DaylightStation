import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const testState = vi.hoisted(() => ({ context: null }));
vi.mock("../../context/FitnessContext.jsx", () => ({ useFitnessContext: () => testState.context }));
vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});
vi.mock('@mantine/core', () => ({ Badge: ({ children }) => <span>{children}</span> }));

import FitnessUsersList from "./FitnessUsers.jsx";

const strap = { deviceId: '101', type: 'heart_rate', heartRate: 171, isActive: true, lastSeen: Date.now() };
const context = (zoneId, progressEntry) => ({
  connected: true, fitnessDevices: new Map(), allDevices: [strap], activeHeartRateParticipants: [strap],
  rpmDevices: [], equipmentDevices: [], deviceConfiguration: { hr: {}, cadence: {} }, equipment: [], users: [],
  hrColorMap: { 101: 'red' }, zones: [], zoneProfiles: [], deviceAssignments: [],
  zoneProgressIndex: new Map([['rider-a', progressEntry]]),
  userCollections: { all: [] }, deviceOwnership: {}, pressureMatActivities: {},
  participantsByDevice: { 101: { id: 'rider-a', profileId: 'rider-a', name: 'Rider A', zoneId } },
  getUserByDevice: () => ({ id: 'rider-a', name: 'Rider A' }),
  getDisplayName: () => ({ displayName: 'Rider A', source: 'profile' }),
  fitnessSessionInstance: { getEquipmentUser: () => null },
});

describe('FitnessUsers zone bar on Fire', () => {
  it('committed Fire renders a full max bar even though there is no next zone', async () => {
    testState.context = context('fire', { profileId: 'rider-a', progress: 0, showBar: false });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.zone-progress-bar')).toBeTruthy());
    expect(container.querySelector('.zone-progress-bar').classList.contains('zone-progress-bar--max')).toBe(true);
    expect(container.querySelector('.zone-progress-fill').style.width).toBe('100%');
  });
  it('other zones keep their normal progress bar', async () => {
    testState.context = context('warm', { profileId: 'rider-a', progress: 0.4, showBar: true });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.zone-progress-bar')).toBeTruthy());
    expect(container.querySelector('.zone-progress-bar--max')).toBeNull();
    expect(container.querySelector('.zone-progress-fill').style.width).toBe('40%');
  });
});
