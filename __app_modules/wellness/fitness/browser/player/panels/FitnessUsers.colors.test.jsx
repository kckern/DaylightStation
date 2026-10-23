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

describe('FitnessUsers card colours: zone owns the colour, the strap gets a dot', () => {
  it('colours the heart by the rider’s zone, not the strap', async () => {
    testState.context = context({ name: 'Rider A', rawZoneId: 'warm', rawZoneColor: '#ffd43b' });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-heart-icon')).toBeTruthy());
    expect(hex(container.querySelector('.fitness-heart-icon').style.color)).toBe('#ffd43b');
  });

  it('draws no strap-coloured ring on the avatar', async () => {
    testState.context = context({ name: 'Rider A', rawZoneId: 'warm', rawZoneColor: '#ffd43b' });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.card-avatar')).toBeTruthy());
    expect(container.querySelector('.card-avatar').style.outline || '').toBe('');
  });

  it('marks the strap with a small labelled dot by the name', async () => {
    testState.context = context({ name: 'Rider A', rawZoneId: 'warm', rawZoneColor: '#ffd43b' });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.device-name')).toBeTruthy());
    const dot = container.querySelector('.device-name .strap-dot');
    expect(dot).toBeTruthy();
    expect(dot.getAttribute('title')).toMatch(/purple/i);
  });

  it('a rider with no zone yet gets a neutral heart', async () => {
    testState.context = context({ name: 'Rider A' });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-heart-icon')).toBeTruthy());
    const color = container.querySelector('.fitness-heart-icon').style.color;
    expect(color).toBeTruthy();
    expect(hex(color)).not.toBe('#b07cf7'); // purple strap sticker
  });

  // Zone config names colours ('green'); the CSS keyword is #008000, not the
  // palette green the card's progress bar and accent use.
  it('maps a named zone colour onto the shared palette for heart and badge', async () => {
    testState.context = context({ name: 'Rider A', rawZoneId: 'active', rawZoneColor: 'green' });
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelector('.fitness-heart-icon')).toBeTruthy());
    expect(hex(container.querySelector('.fitness-heart-icon').style.color)).toBe('#51cf66');
    const badge = container.querySelector('.zone-badge-probe');
    expect(badge).toBeTruthy();
    expect(hex(badge.style.backgroundColor)).toBe('#51cf66');
  });
});
