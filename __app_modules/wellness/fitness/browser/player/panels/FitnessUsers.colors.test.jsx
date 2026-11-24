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

// The zone badge is a Mantine Badge; keep its inline style to read the colour.
vi.mock('@mantine/core', () => ({ Badge: ({ children, style }) => <span className="zone-badge-probe" style={style}>{children}</span> }));

import FitnessUsersList from "./FitnessUsers.jsx";

const strap = { deviceId: '101', type: 'heart_rate', heartRate: 141, isActive: true, lastSeen: Date.now() };
const context = (participant) => ({
  connected: true, fitnessDevices: new Map(), allDevices: [strap], activeHeartRateParticipants: [strap],
  rpmDevices: [], equipmentDevices: [], deviceConfiguration: { hr: {}, cadence: {} }, equipment: [], users: [],
  hrColorMap: { 101: 'purple' }, zones: [], zoneProfiles: [], deviceAssignments: [], zoneProgressIndex: new Map(),
  userCollections: { all: [] }, deviceOwnership: {}, pressureMatActivities: {},
  participantsByDevice: { 101: participant },
  getUserByDevice: () => ({ id: 'rider-a', name: 'Rider A' }),
  getDisplayName: () => ({ displayName: 'Rider A', source: 'profile' }),
  fitnessSessionInstance: { getEquipmentUser: () => null },
});

// jsdom keeps a hex colour as written and normalises everything else to rgb().
const hex = (css) => (css.startsWith('#')
  ? css.toLowerCase()
  : '#' + css.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join(''));

describe('FitnessUsers strap identity and earned zone', () => {
  it.each(['cool', 'active', 'warm', 'hot', 'fire', null])('keeps a purple heart through %s', async (zoneId) => {
    testState.context = context({ name: 'Rider A', zoneId, rawZoneId: 'fire' });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-heart-icon')).toBeTruthy());
    expect(hex(container.querySelector('.fitness-heart-icon').style.color)).toBe('#b07cf7');
    // The heart is the only strap identifier; the old name dot duplicated it.
    expect(container.querySelector('.strap-dot')).toBeNull();
    // No committed zone yet, but a live 141 bpm reading: the card wears the
    // zone that reading is in (rawZoneId), never "no-zone" (2026-11-10).
    expect(container.querySelector('.fitness-device').classList.contains(zoneId ? `zone-${zoneId}` : 'zone-fire')).toBe(true);
  });

  it('measures the bar on the rider\'s validated ladder, in the committed zone', async () => {
    // Committed Hot while the card prints 141: on the rider's own ladder (Hot
    // from 140) the card, badge and bar all say Hot, 5% into the band.
    const ladder = [
      { id: 'cool', name: 'Cool', min: 0, color: 'blue' },
      { id: 'active', name: 'Active', min: 100, color: 'green' },
      { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
      { id: 'hot', name: 'Hot', min: 140, color: 'orange' },
      { id: 'fire', name: 'Fire', min: 160, color: 'red' },
    ];
    testState.context = { ...context({ name: 'Rider A', zoneId: 'warm', rawZoneId: 'fire' }),
      zoneProfiles: [{ id: 'rider-a', name: 'Rider A', zoneTrusted: true, currentZoneId: 'hot', zoneConfig: ladder }] };
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-device.zone-hot')).toBeTruthy());
    expect(container.querySelector('.device-value').textContent).toBe('141');
    expect(container.querySelector('.zone-progress-fill').style.width).toBe('5%');
  });

  // An explicitly null committed profile is never revived as EARNED state (the
  // participant's 'hot' stays out), but a trusted card shows the live reading's zone.
  it('shows the live reading\'s zone, not the stale committed one, over a null profile', async () => {
    testState.context = { ...context({ name: 'Rider A', zoneId: 'hot', rawZoneId: 'fire' }),
      zoneProfiles: [{ id: 'rider-a', name: 'Rider A', zoneTrusted: true, currentZoneId: null }] };
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-device.zone-fire')).toBeTruthy());
    expect(container.querySelector('.fitness-device.zone-hot')).toBeNull();
    expect(hex(container.querySelector('.fitness-heart-icon').style.color)).toBe('#b07cf7');
  });
  // 2026-11-23 (owner): an untrusted reading claims no zone, however hot it reads.
  it('an untrusted profile shows the untrusted mark, neither the live nor the stale zone', async () => {
    testState.context = { ...context({ name: 'Rider A', zoneId: 'hot', rawZoneId: 'fire' }),
      zoneProfiles: [{ id: 'rider-a', name: 'Rider A', zoneTrusted: false, currentZoneId: null }] };
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-device.zone-untrusted')).toBeTruthy());
    expect(container.querySelector('.fitness-device.zone-fire')).toBeNull();
    expect(container.querySelector('.fitness-device.zone-hot')).toBeNull();
  });
  it('shows No Zone only when there is no reading', async () => {
    testState.context = { ...context({ name: 'Rider A', zoneId: null, rawZoneId: 'fire', heartRate: null }),
      allDevices: [{ ...strap, heartRate: null }], activeHeartRateParticipants: [{ ...strap, heartRate: null }],
      zoneProfiles: [{ id: 'rider-a', name: 'Rider A', zoneTrusted: false, currentZoneId: null }] };
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-device.no-zone')).toBeTruthy());
  });
  it('uses the current guest profile before the physical strap owner profile', async () => {
    testState.context = { ...context({ id: 'guest-a', profileId: 'guest-a', name: 'Guest A', zoneId: null, rawZoneId: 'fire' }),
      getDisplayName: () => ({displayName: 'Guest A', source: 'assignment'}),
      zoneProfiles: [
        {id:'rider-a', name:'Rider A', zoneTrusted:true, currentZoneId:'hot'},
        {id:'guest-a', name:'Guest A', zoneTrusted:false, currentZoneId:null},
      ] };
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-device')).toBeTruthy());
    // The owner's committed Hot never leaks onto the guest; the guest's own
    // profile decides, and it is untrusted, so the card claims no zone.
    expect(container.querySelector('.fitness-device').classList.contains('zone-hot')).toBe(false);
    expect(container.querySelector('.fitness-device').classList.contains('zone-untrusted')).toBe(true);
  });

});
