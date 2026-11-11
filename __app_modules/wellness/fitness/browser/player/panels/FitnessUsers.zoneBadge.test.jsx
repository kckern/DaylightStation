/**
 * Player sidebar, 2026-11-10: a rider with a live 132 bpm reading sat under a
 * "NO ZONE" header until the zone store had sustained readings (startup trust
 * waits for a real Cool or recent evidence). A heart rate on screen is a zone
 * on screen: the card shows the zone that reading is in on the same ladder the
 * store uses, and only says "No Zone" when there is no reading at all.
 */
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

vi.mock('@mantine/core', () => ({ Badge: ({ children, title }) => <span className="zone-badge" title={title}>{children}</span> }));

import FitnessUsersList from "./FitnessUsers.jsx";

const ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 150, color: 'orange' },
];

const participant = (over = {}) => ({
  id: 'rider-a', profileId: 'rider-a', name: 'Rider A', displayLabel: 'Rider A', deviceId: '101',
  type: 'heart_rate', heartRate: 132, isActive: true, lastSeen: Date.now(),
  zoneId: null, zoneColor: null, zoneTrusted: false, rawZoneId: null, zoneProgress: null,
  ...over,
});

const context = (participants, extra = {}) => ({
  connected: true,
  fitnessDevices: new Map(),
  allDevices: participants,
  activeHeartRateParticipants: participants,
  rpmDevices: [],
  equipmentDevices: [],
  deviceConfiguration: { hr: {}, cadence: {} },
  equipment: [],
  users: [],
  hrColorMap: {},
  zones: ZONES,
  zoneProfiles: [],
  deviceAssignments: [],
  zoneProgressIndex: new Map(),
  userCollections: { all: [] },
  deviceOwnership: {},
  pressureMatActivities: {},
  getUserByDevice: () => null,
  getDisplayName: (id) => ({ displayName: participants.find((p) => p.deviceId === id)?.name || id, source: 'profile' }),
  fitnessSessionInstance: { getEquipmentUser: () => null },
  governanceState: null,
  ...extra,
});

const badges = (container) => Array.from(container.querySelectorAll('.zone-badge')).map((el) => el.textContent.trim());

describe('FitnessUsers zone badge with a live reading', () => {
  it('shows the live reading\'s zone (the roster raw zone) before the store trusts the rider', async () => {
    testState.context = context([participant({ rawZoneId: 'warm' })]);
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.device-name')).not.toBeNull());
    expect(badges(container)).toEqual(['Warm']);
    expect(container.textContent).not.toMatch(/No Zone/i);
    expect(container.querySelector('.device-zone-info.zone-warm')).not.toBeNull();
  });

  it('reads the household ladder off the heart rate when nothing else names a zone', async () => {
    testState.context = context([participant({ rawZoneId: null, heartRate: 132 })]);
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.device-name')).not.toBeNull());
    expect(badges(container)).toEqual(['Warm']);
    expect(container.textContent).not.toMatch(/No Zone/i);
  });

  it('still says No Zone when there is no reading at all', async () => {
    testState.context = context([participant({ heartRate: null, rawZoneId: 'warm' })]);
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.device-name')).not.toBeNull());
    expect(badges(container)).toEqual(['No Zone']);
  });

  it('files the card under the same header as a trusted rider in that zone', async () => {
    // Pre-sorted as FitnessContext would (hot, then both warm): one Warm header, no NO ZONE.
    const riderC = participant({ id: 'rider-c', profileId: 'rider-c', name: 'Rider C', deviceId: '103', heartRate: 160, zoneId: 'hot', zoneTrusted: true, rawZoneId: 'hot' });
    const riderB = participant({ id: 'rider-b', profileId: 'rider-b', name: 'Rider B', deviceId: '102', heartRate: 128, zoneId: 'warm', zoneTrusted: true, rawZoneId: 'warm' });
    const riderA = participant({ rawZoneId: 'warm' });
    testState.context = context([riderC, riderB, riderA]);
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelectorAll('.device-name').length).toBe(3));
    expect(badges(container)).toEqual(['Hot', 'Warm']);
    expect(container.textContent).not.toMatch(/No Zone/i);
  });
});
