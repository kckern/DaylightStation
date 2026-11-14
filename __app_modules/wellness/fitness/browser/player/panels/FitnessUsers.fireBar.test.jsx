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

const LADDER = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange' },
  { id: 'fire', name: 'Fire', min: 160, color: 'red' },
];
const strapAt = (heartRate) => ({ deviceId: '101', type: 'heart_rate', heartRate, isActive: true, lastSeen: Date.now() });
// `zoneId` is the rider's COMMITTED zone (anti-flap); the card must ignore it
// whenever it has a reading, and show the zone of the BPM it prints.
const context = (zoneId, heartRate, { zones = LADDER } = {}) => {
  const strap = strapAt(heartRate);
  return {
    connected: true, fitnessDevices: new Map(), allDevices: [strap], activeHeartRateParticipants: [strap],
    rpmDevices: [], equipmentDevices: [], deviceConfiguration: { hr: {}, cadence: {} }, equipment: [], users: [],
    hrColorMap: { 101: 'red' }, zones, zoneProfiles: [], deviceAssignments: [],
    userCollections: { all: [] }, deviceOwnership: {}, pressureMatActivities: {},
    participantsByDevice: { 101: { id: 'rider-a', profileId: 'rider-a', name: 'Rider A', zoneId, heartRate } },
    getUserByDevice: () => ({ id: 'rider-a', name: 'Rider A' }),
    getDisplayName: () => ({ displayName: 'Rider A', source: 'profile' }),
    fitnessSessionInstance: { getEquipmentUser: () => null },
  };
};
const card = (container) => container.querySelector('.fitness-device');
const fill = (container) => container.querySelector('.zone-progress-fill')?.style.width;

describe('FitnessUsers zone bar on Fire', () => {
  it('Fire renders a full max bar even though there is no next zone', async () => {
    testState.context = context('fire', 171);
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.zone-progress-bar')).toBeTruthy());
    expect(container.querySelector('.zone-progress-bar').classList.contains('zone-progress-bar--max')).toBe(true);
    expect(fill(container)).toBe('100%');
  });

  it('other zones keep their normal progress bar, measured on the zone shown', async () => {
    testState.context = context('warm', 128);
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.zone-progress-bar')).toBeTruthy());
    expect(container.querySelector('.zone-progress-bar--max')).toBeNull();
    expect(fill(container)).toBe('40%'); // 128 on the 120→140 Warm band
  });

  it('a committed zone held by the exit margin does not colour the card: colour and bar agree with the BPM', async () => {
    // Committed Hot (floor 140), now at 137: the card is Warm with a Warm-band
    // bar — not Hot over a "nearly at Fire"-looking bar (2026-11-13 report).
    testState.context = context('hot', 137);
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.zone-progress-bar')).toBeTruthy());
    expect(card(container).className).toMatch(/zone-warm/);
    expect(card(container).className).not.toMatch(/zone-hot/);
    expect(fill(container)).toBe('85%');
  });

  it('an upward crossing still awaiting confirmation shows the new zone and its fresh bar', async () => {
    // Committed Warm; the BPM just reached Hot (142).
    testState.context = context('warm', 142);
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.zone-progress-bar')).toBeTruthy());
    expect(card(container).className).toMatch(/zone-hot/);
    expect(fill(container)).toBe('10%');
  });

  it('just below the Fire floor, a committed Fire is not shown as Fire', async () => {
    testState.context = context('fire', 157);
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.zone-progress-bar')).toBeTruthy());
    expect(container.querySelector('.zone-progress-bar--max')).toBeNull();
    expect(card(container).className).toMatch(/zone-hot/);
    expect(fill(container)).toBe('85%');
  });
});
