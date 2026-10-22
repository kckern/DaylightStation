import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const riders = (n) => Array.from({ length: n }, (_, i) => ({ deviceId: String(200 + i), type: 'heart_rate', heartRate: 120 + i, isActive: true, lastSeen: Date.now() }));
const context = (devs) => ({
  connected: true, fitnessDevices: new Map(), allDevices: devs, activeHeartRateParticipants: devs,
  rpmDevices: [], equipmentDevices: [], deviceConfiguration: { hr: {}, cadence: {} }, equipment: [], users: [],
  hrColorMap: {}, zones: [], zoneProfiles: [], deviceAssignments: [], zoneProgressIndex: new Map(),
  userCollections: { all: [] }, deviceOwnership: {}, pressureMatActivities: {},
  getUserByDevice: () => null, getDisplayName: (id) => ({ displayName: `Rider ${id}`, source: 'profile' }),
  fitnessSessionInstance: { getEquipmentUser: () => null },
});

// jsdom has no layout: the list is 530px tall; its content's height depends on
// which card size the grid carries.
const contentHeight = { 'horiz-scale-150': 760, 'horiz-scale-130': 640, regular: 520, 'density-compact': 300 };
let restore = [];
beforeEach(() => {
  const ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.classList.contains('fitness-devices') ? 530 : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() {
    const grid = this.querySelector?.('.device-grid');
    if (!grid) return 0;
    const cls = Object.keys(contentHeight).find((c) => grid.classList.contains(c));
    return contentHeight[cls || 'regular'];
  } });
  restore = [['clientHeight', ch], ['scrollHeight', sh]];
});
afterEach(() => restore.forEach(([k, d]) => (d ? Object.defineProperty(HTMLElement.prototype, k, d) : delete HTMLElement.prototype[k])));

describe('FitnessUsers card size follows the room, not the rider count', () => {
  it('five riders get the largest cards that fit, not the compact jump', async () => {
    testState.context = context(riders(5));
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelectorAll('.fitness-device').length).toBe(5));
    const grid = container.querySelector('.device-grid');
    expect(grid.className).not.toMatch(/horiz-scale|density-compact/);
    expect(container.querySelector('.card-compact')).toBeNull();
  });

  it('never shrinks the list with a transform', async () => {
    testState.context = context(riders(8));
    const { container } = render(<FitnessUsersList />);
    await waitFor(() => expect(container.querySelectorAll('.fitness-device').length).toBe(8));
    const content = container.querySelector('.fitness-devices > div');
    expect(content.style.transform || '').not.toMatch(/scale/);
  });
});
