import { describe, it, expect } from 'vitest';
import { evaluateFireCeremony, FIRE_CEREMONY_FRESH_MS } from './fireCeremonyEligibility.js';

/**
 * A queued Fire ceremony is shown only if, at the moment it would appear, the
 * rider is STILL in the same uninterrupted Fire stint on a fresh, real reading.
 * Owner rule: a Fire ceremony never happens if the rider is not actually in Fire.
 */
const NOW = 1_000_000;
const queued = (over = {}) => ({
  userId: 'rider-a', entryId: 7, heartRate: 192, fireThreshold: 190,
  deviceId: 'strap-1', sessionId: 'session-1', queuedAt: NOW - 20_000, ...over
});
const live = (over = {}) => ({
  id: 'rider-a', zoneTrusted: true, currentZoneId: 'fire', heartRate: 195,
  zoneEntry: { id: 7, zoneId: 'fire', heartRate: 192, threshold: 190 },
  zoneConfig: [{ id: 'cool', min: 60 }, { id: 'hot', min: 160 }, { id: 'fire', min: 190 }],
  zoneReadingAt: NOW - 500, zoneReadingDeviceId: 'strap-1', zoneReadingEligible: true,
  zoneReadingSimulated: false, ...over
});
const judge = (q, l, sessionId = 'session-1') => evaluateFireCeremony(q, l, { now: NOW, sessionId });

describe('evaluateFireCeremony (display-time re-check)', () => {
  it('shows a ceremony for a rider still in the same Fire stint, reporting the CURRENT HR', () => {
    expect(judge(queued(), live())).toEqual({ show: true, reason: null, heartRate: 195, fireThreshold: 190 });
  });

  it('drops the entry when the rider fell out of Fire while it was queued', () => {
    expect(judge(queued(), live({ currentZoneId: 'hot', heartRate: 170 })).reason).toBe('not-in-fire');
  });

  it('drops the entry after a session reset (different session id)', () => {
    expect(judge(queued(), live(), 'session-2')).toMatchObject({ show: false, reason: 'session-changed' });
    expect(judge(queued(), live(), null)).toMatchObject({ show: false, reason: 'session-changed' });
  });

  it('drops the entry when the rider is gone or untrusted', () => {
    expect(judge(queued(), null).reason).toBe('rider-gone');
    expect(judge(queued(), live({ zoneTrusted: false })).reason).toBe('untrusted');
  });

  it('drops the entry when the Fire stint is a different one (left and re-entered, or reset)', () => {
    expect(judge(queued(), live({ zoneEntry: { id: 9, zoneId: 'fire', heartRate: 191, threshold: 190 } })).reason).toBe('entry-changed');
    expect(judge(queued(), live({ zoneEntry: null })).reason).toBe('entry-changed');
  });

  it('drops the entry when the reading is stale, missing or ineligible', () => {
    expect(judge(queued(), live({ zoneReadingAt: NOW - FIRE_CEREMONY_FRESH_MS - 1 })).reason).toBe('hr-stale');
    expect(judge(queued(), live({ zoneReadingAt: null })).reason).toBe('hr-stale');
    expect(judge(queued(), live({ heartRate: null })).reason).toBe('hr-stale');
    expect(judge(queued(), live({ zoneReadingEligible: false })).reason).toBe('hr-stale');
  });

  it('drops the entry when the current HR is below the current Fire minimum (held by exit margin)', () => {
    expect(judge(queued(), live({ heartRate: 187 })).reason).toBe('hr-below-fire');
  });

  it('measures against the CURRENT Fire minimum, not the one at queue time', () => {
    const raised = live({ zoneConfig: [{ id: 'cool', min: 60 }, { id: 'fire', min: 200 }] });
    expect(judge(queued(), raised).reason).toBe('hr-below-fire');
  });

  it('drops the entry when the reading now comes from another strap (wearer/device change)', () => {
    expect(judge(queued(), live({ zoneReadingDeviceId: 'strap-2' })).reason).toBe('device-changed');
  });

  it('drops the entry when the rider is fed by the simulator', () => {
    expect(judge(queued(), live({ zoneReadingSimulated: true })).reason).toBe('simulated');
    expect(judge(queued(), live({ zoneEntry: { id: 7, zoneId: 'fire', heartRate: 192, threshold: 190, simulated: true } })).reason).toBe('simulated');
  });
});
