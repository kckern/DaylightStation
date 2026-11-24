// Sidebar scene: the governance status bar (pending) over the rider list, with
// Rider A collecting (3 readings), Rider B with no signal, Rider C with a
// drawn trend, and one bike pinned below claimed by Rider A at 56 RPM.
// Fixture names only (public repo).
import React from 'react';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import FitnessGovernance from '../../../__app_modules/wellness/fitness/browser/player/panels/FitnessGovernance.jsx';
import FitnessUsersList from '../../../__app_modules/wellness/fitness/browser/player/panels/FitnessUsers.jsx';
import '../../../__app_modules/wellness/fitness/browser/player/FitnessSidebar.scss';
import { FitnessContext } from './stubs/FitnessContext.jsx';

const ZONES = [
  { id: 'cool', name: 'Cool', min: 0, color: 'blue' },
  { id: 'active', name: 'Active', min: 100, color: 'green' },
  { id: 'warm', name: 'Warm', min: 120, color: 'yellow' },
  { id: 'hot', name: 'Hot', min: 140, color: 'orange' },
  { id: 'fire', name: 'Fire', min: 160, color: 'red' },
];
const SEQ = ZONES.map((z) => ({ id: z.id, name: z.name, threshold: z.min, color: z.color }));
const RIDERS = [
  { deviceId: '201', id: 'rider_a', name: 'Rider A', heartRate: 96, zoneId: 'cool', color: 'red' },
  { deviceId: '202', id: 'rider_b', name: 'Rider B', heartRate: null, zoneId: null, color: null },
  { deviceId: '203', id: 'rider_c', name: 'Rider C', heartRate: 134, zoneId: 'warm', color: 'purple' },
];
const TICKS = 40;
const SERIES = {
  rider_a: Array.from({ length: TICKS }, (_, i) => (i >= TICKS - 3 ? 92 + i - (TICKS - 3) * 1 : null)),
  rider_b: Array.from({ length: TICKS }, () => null),
  rider_c: Array.from({ length: TICKS }, (_, i) => Math.round(98 + i * 0.9 + 6 * Math.sin(i / 4))),
};
const devices = RIDERS.map((r) => ({ deviceId: r.deviceId, type: 'heart_rate', heartRate: r.heartRate, isActive: true, lastSeen: Date.now() }));
const byDevice = Object.fromEntries(RIDERS.map((r) => [r.deviceId, { id: r.id, profileId: r.id, name: r.name, heartRate: r.heartRate, zoneId: r.zoneId, rawZoneId: r.zoneId, timelineUserId: r.id }]));

const CTX = {
  governanceState: { isGoverned: true, status: 'pending' },
  connected: true, fitnessDevices: new Map(), allDevices: devices, activeHeartRateParticipants: devices,
  rpmDevices: [{ deviceId: '7001', cadence: 56, type: 'cadence', isActive: true, lastSeen: Date.now() }],
  equipmentDevices: [], deviceConfiguration: { hr: {}, cadence: {} },
  equipment: [{ name: 'Blue Bike', id: 'blue-bike', type: 'bike', cadence: 7001 }],
  users: [], zones: ZONES, deviceAssignments: [], zoneProgressIndex: new Map(), deviceOwnership: {}, pressureMatActivities: {},
  hrColorMap: Object.fromEntries(RIDERS.filter((r) => r.color).map((r) => [r.deviceId, r.color])),
  zoneProfiles: RIDERS.map((r) => ({ id: r.id, name: r.name, zoneTrusted: true, currentZoneId: r.zoneId, zoneConfig: ZONES, zoneSequence: SEQ })),
  userCollections: { all: RIDERS.map((r) => ({ id: r.id, name: r.name })) },
  participantsByDevice: byDevice,
  getUserByDevice: (id) => { const r = RIDERS.find((x) => x.deviceId === String(id)); return r ? { id: r.id, name: r.name } : null; },
  getDisplayName: (id) => { const r = RIDERS.find((x) => x.deviceId === String(id)); return r ? { displayName: r.name, source: 'profile' } : { displayName: String(id), source: 'fallback' }; },
  getParticipantTimelineSeries: (id, metric) => (metric === 'heart_rate' ? SERIES[id] || [] : []),
  timelineTimebase: { tickCount: TICKS, intervalMs: 5000 },
  fitnessSessionInstance: { getEquipmentUser: () => null, getEquipmentRider: (id) => (id === 'blue-bike' ? 'rider_a' : null) },
};

export const sidebarScene = () => (
  <MantineProvider defaultColorScheme="dark">
    <FitnessContext.Provider value={CTX}>
      <div className="fitness-sidebar-container" style={{ position: 'absolute', right: 0, top: 0, width: 250, height: '100%', background: '#111' }}>
        <div className="fitness-sidebar-governance"><FitnessGovernance /></div>
        <div className="fitness-sidebar-devices"><FitnessUsersList /></div>
      </div>
    </FitnessContext.Provider>
  </MantineProvider>
);
