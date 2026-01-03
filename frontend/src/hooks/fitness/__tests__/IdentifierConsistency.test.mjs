import { describe, expect, test } from '@jest/globals';

import { buildActiveParticipantIds, buildUserZoneMap } from '../types.js';
import { MetricsRecorder } from '../MetricsRecorder.js';
import { FitnessTreasureBox } from '../TreasureBox.js';
import { GovernanceEngine } from '../GovernanceEngine.js';

describe('FitnessApp Identifier Consistency', () => {
  test('activeParticipants matches userZoneMap keys', () => {
    const roster = [
      { id: 'kckern', name: 'KC Kern', zoneId: 'fire', isActive: true },
      { profileId: 'felix', name: 'Felix', zoneId: 'warm', isActive: true },
      { id: 'inactive', name: 'Inactive', zoneId: 'cool', isActive: false },
      { name: 'MissingId', zoneId: 'hot', isActive: true }
    ];

    const activeParticipants = buildActiveParticipantIds(roster);
    const userZoneMap = buildUserZoneMap(roster);

    expect(activeParticipants.sort()).toEqual(['felix', 'kckern']);

    activeParticipants.forEach((userId) => {
      expect(Object.prototype.hasOwnProperty.call(userZoneMap, userId)).toBe(true);
    });
  });

  test('TreasureBox tracks same IDs as FitnessSession provides', () => {
    const sessionRef = {
      _log: () => {},
      timebase: { intervalMs: 5000, intervalCount: 0 },
      startTime: Date.now()
    };

    const tb = new FitnessTreasureBox(sessionRef);
    tb.setActivityMonitor({ isActive: () => true });
    tb.configure({
      coinTimeUnitMs: 1000,
      zones: [
        { id: 'cool', name: 'Cool', min: 60, color: 'blue', coins: 1 },
        { id: 'warm', name: 'Warm', min: 120, color: 'yellow', coins: 2 },
        { id: 'fire', name: 'Fire', min: 160, color: 'red', coins: 3 }
      ],
      users: []
    });

    tb.recordUserHeartRate('kckern', 170, { profileId: 'kckern' });

    const acc = tb.perUser.get('kckern');
    expect(acc).toBeTruthy();
    // Force interval completion
    acc.currentIntervalStart = Date.now() - 10_000;

    tb.processTick(1, new Set(['kckern']), {});

    const totals = tb.getPerUserTotals();
    expect(Array.from(totals.keys())).toEqual(['kckern']);

    const snapshot = tb.getUserZoneSnapshot();
    expect(snapshot[0].userId).toBe('kckern');
    expect(snapshot[0].entityId).toBe(null);
  });

  test('GovernanceEngine detects all active users', () => {
    const engine = new GovernanceEngine(null);

    const activeParticipants = ['kckern', 'felix'];
    const userZoneMap = { kckern: 'fire', felix: 'warm' };
    const zoneRankMap = { cool: 0, warm: 2, fire: 4 };
    const zoneInfoMap = {
      warm: { id: 'warm', name: 'Warm' },
      fire: { id: 'fire', name: 'Fire' }
    };

    const summary = engine._evaluateZoneRequirement(
      'warm',
      1,
      activeParticipants,
      userZoneMap,
      zoneRankMap,
      zoneInfoMap,
      activeParticipants.length
    );

    expect(summary.actualCount).toBe(2);
    expect(summary.missingUsers).toEqual([]);
    expect(summary.satisfied).toBe(true);
  });

  test('Timeline keys consistent across MetricsRecorder and TreasureBox (nulls preserved)', () => {
    const recorder = new MetricsRecorder({ intervalMs: 5000 });

    const deviceManager = {
      getAllDevices: () => []
    };

    const userManager = {
      resolveUserForDevice: () => null
    };

    const treasureBox = {
      summary: { totalCoins: 5 },
      getPerUserTotals: () => new Map([
        ['kckern', NaN],
        ['felix', 3]
      ])
    };

    const { tickPayload } = recorder.collectMetrics({
      timestamp: Date.now(),
      tickIndex: 0,
      deviceManager,
      userManager,
      treasureBox,
      pendingSnapshotRef: 'snap-1'
    });

    // Strict series scope is user:<userId>:<metric>
    expect(Object.keys(tickPayload).some((k) => k.startsWith('entity:'))).toBe(false);

    // Nulls must be preserved (not dropped) for invalid coin values
    expect(Object.prototype.hasOwnProperty.call(tickPayload, 'user:kckern:coins_total')).toBe(true);
    expect(tickPayload['user:kckern:coins_total']).toBe(null);

    // Global keys must not be rejected by validators downstream
    expect(Object.prototype.hasOwnProperty.call(tickPayload, 'global:coins_total')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(tickPayload, 'global:snapshot_ref')).toBe(true);
  });
});
