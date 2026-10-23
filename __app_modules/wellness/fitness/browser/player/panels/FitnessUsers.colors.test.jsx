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
    expect(container.querySelector('.fitness-device').classList.contains(zoneId ? `zone-${zoneId}` : 'no-zone')).toBe(true);
  });

  it('uses the trusted committed profile even when raw HR has crossed another zone', async () => {
    testState.context = { ...context({ name: 'Rider A', zoneId: 'warm', rawZoneId: 'fire' }),
      zoneProfiles: [{ id: 'rider-a', name: 'Rider A', zoneTrusted: true, currentZoneId: 'active', zoneSnapshot: { currentZoneId: 'fire' } }] };
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-device.zone-active')).toBeTruthy());
    expect(hex(container.querySelector('.zone-badge-probe').style.backgroundColor)).toBe('#51cf66');
    expect(container.querySelector('.device-value').textContent).toBe('141');
  });

  it.each([false, true])('never revives an explicitly null committed profile (trust %s)', async (zoneTrusted) => {
    testState.context = { ...context({ name: 'Rider A', zoneId: 'hot', rawZoneId: 'fire' }),
      zoneProfiles: [{ id: 'rider-a', name: 'Rider A', zoneTrusted, currentZoneId: null }] };
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-device.no-zone')).toBeTruthy());
    expect(hex(container.querySelector('.fitness-heart-icon').style.color)).toBe('#b07cf7');
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
    expect(container.querySelector('.fitness-device').classList.contains('no-zone')).toBe(true);
  });

});
