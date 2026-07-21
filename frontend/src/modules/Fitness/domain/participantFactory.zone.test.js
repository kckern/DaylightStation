import { describe, it, expect } from 'vitest';
import { fromRosterEntry } from './ParticipantFactory.js';
import { buildZoneProgressIndex } from './zoneProgressIndex.js';

const ROSTER_ENTRY = {
  id: 'user_1',
  profileId: 'user_1',
  name: 'Kevin',
  displayLabel: 'Dad',
  hrDeviceId: '10366',
  heartRate: 115,
  zoneId: 'cool',       // committed (hysteresis-smoothed)
  rawZoneId: 'active',  // live
  rawZoneColor: '#51cf66',
  isActive: true,
};

describe('fromRosterEntry zone fields', () => {
  it('carries rawZoneId through to the entity', () => {
    expect(fromRosterEntry(ROSTER_ENTRY).rawZoneId).toBe('active');
  });

  it('normalizes rawZoneId to lowercase', () => {
    expect(fromRosterEntry({ ...ROSTER_ENTRY, rawZoneId: 'ACTIVE' }).rawZoneId).toBe('active');
  });

  it('falls back to the committed zone when rawZoneId is absent', () => {
    expect(fromRosterEntry({ ...ROSTER_ENTRY, rawZoneId: null }).rawZoneId).toBe('cool');
  });

  it('REGRESSION: resolves zoneProgress by profileId even when displayLabel is a group label', () => {
    const index = buildZoneProgressIndex(
      new Map([['user_1', { name: 'Kevin', displayLabel: 'Dad', progress: 0.66, profileId: 'user_1' }]])
    );
    expect(fromRosterEntry(ROSTER_ENTRY, { zoneProgressIndex: index }).zoneProgress).toBe(0.66);
  });

  it('leaves zoneProgress null when no index is supplied', () => {
    expect(fromRosterEntry(ROSTER_ENTRY).zoneProgress).toBeNull();
  });

  it('leaves zoneProgress null on an index miss rather than coercing to 0', () => {
    const index = buildZoneProgressIndex(new Map([['other', { name: 'Other', progress: 0.5 }]]));
    expect(fromRosterEntry(ROSTER_ENTRY, { zoneProgressIndex: index }).zoneProgress).toBeNull();
  });

  it('preserves a real zoneProgress of 0 rather than nulling it', () => {
    const index = buildZoneProgressIndex(
      new Map([['user_1', { name: 'Kevin', progress: 0, profileId: 'user_1' }]])
    );
    expect(fromRosterEntry(ROSTER_ENTRY, { zoneProgressIndex: index }).zoneProgress).toBe(0);
  });
});
