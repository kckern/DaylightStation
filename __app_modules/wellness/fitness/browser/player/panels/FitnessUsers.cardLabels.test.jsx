import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const testState = vi.hoisted(() => ({ context: null }));

vi.mock("../../context/FitnessContext.jsx", () => ({
  useFitnessContext: () => testState.context,
}));

vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

vi.mock('@mantine/core', () => ({ Badge: ({ children }) => <span>{children}</span> }));

import FitnessUsersList from "./FitnessUsers.jsx";

const strap = (heartRate) => ({ deviceId: '101', type: 'heart_rate', heartRate, isActive: true, lastSeen: Date.now() });
const context = ({ heartRate = 120, hrColorMap = { 101: 'purple' }, ...rest } = {}) => ({
  connected: true, fitnessDevices: new Map(), allDevices: [strap(heartRate)], activeHeartRateParticipants: [strap(heartRate)],
  rpmDevices: [], equipmentDevices: [], deviceConfiguration: { hr: {}, cadence: {} }, equipment: [], users: [],
  hrColorMap, zones: [], zoneProfiles: [], deviceAssignments: [], zoneProgressIndex: new Map(),
  userCollections: { all: [] }, deviceOwnership: {}, pressureMatActivities: {},
  participantsByDevice: { 101: { name: 'Rider A', heartRate } },
  getUserByDevice: () => ({ id: 'rider-a', name: 'Rider A' }),
  getDisplayName: () => ({ displayName: 'Rider A', source: 'profile' }),
  fitnessSessionInstance: { getEquipmentUser: () => null },
  ...rest,
});

describe('FitnessUsers card labels', () => {
  it('says "No signal" instead of a bare BPM unit when there is no reading', async () => {
    testState.context = context({ heartRate: null });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-device')).toBeTruthy());
    expect(container.querySelector('.device-value').textContent).toBe('No signal');
    expect(container.querySelector('.device-unit')).toBeNull();
  });

  it('keeps the number and BPM unit when there is a reading', async () => {
    testState.context = context({ heartRate: 131 });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-device')).toBeTruthy());
    expect(container.querySelector('.device-value').textContent).toBe('131');
    expect(container.querySelector('.device-unit').textContent).toBe('BPM');
  });

  it('labels the heart as the strap sticker colour', async () => {
    testState.context = context();
    render(<FitnessUsersList />);
    expect(await screen.findByRole('img', { name: 'Strap colour: Purple' })).toBeTruthy();
  });

  it('labels a grey heart as a strap with no colour on file', async () => {
    testState.context = context({ hrColorMap: {} });
    render(<FitnessUsersList />);
    expect(await screen.findByRole('img', { name: 'No strap colour on file' })).toBeTruthy();
  });

  it('labels each pinned RPM circle with its equipment and its rider', async () => {
    testState.context = context({
      rpmDevices: [{ deviceId: '7001', cadence: 56, type: 'cadence', isActive: true, lastSeen: Date.now() }],
      equipment: [{ name: 'Blue Bike', id: 'blue-bike', type: 'bike', cadence: 7001 }],
      userCollections: { all: [{ id: 'rider-b', name: 'Rider B' }] },
      fitnessSessionInstance: { getEquipmentUser: () => null, getEquipmentRider: (id) => (id === 'blue-bike' ? 'rider-b' : null) },
    });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.rpm-device-avatar')).toBeTruthy());
    const item = container.querySelector('.rpm-device-item');
    expect(item.querySelector('.rpm-device-name').textContent).toBe('Blue Bike');
    expect(item.querySelector('.rpm-device-rider').textContent).toBe('Rider B');
  });

  it('says "No rider" on an unclaimed RPM circle', async () => {
    testState.context = context({
      rpmDevices: [{ deviceId: '7001', cadence: 0, type: 'cadence', isActive: true, lastSeen: Date.now() }],
      equipment: [{ name: 'Blue Bike', id: 'blue-bike', type: 'bike', cadence: 7001 }],
    });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.rpm-device-item')).toBeTruthy());
    expect(container.querySelector('.rpm-device-name').textContent).toBe('Blue Bike');
    expect(container.querySelector('.rpm-device-rider').textContent).toBe('No rider');
  });
});
