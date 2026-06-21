import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeRosterFromParticipants } from './YamlSessionDatastore.mjs';
import { TimelapseFrameMapper } from '#domains/fitness/services/TimelapseFrameMapper.mjs';

// Regression: the v2 `participants` map must synthesize roster entries that carry
// the slug as `id` and the name as `display_name`. Dropping the slug made every
// participant resolve to "Unknown" and collapsed all HR onto the first series.
test('synthesizes roster entries that carry id (slug) and display_name', () => {
  const roster = synthesizeRosterFromParticipants({
    kckern: { display_name: 'KC Kern', hr_device: '40475', is_primary: true },
    felix: { display_name: 'Felix', hr_device: '28812' }
  });
  assert.deepEqual(roster.map(r => r.id), ['kckern', 'felix']);
  assert.equal(roster[0].display_name, 'KC Kern');
  assert.equal(roster[0].avatarRef, 'kckern');
  assert.equal(roster[1].display_name, 'Felix');
});

test('falls back to slug when a participant has no display_name', () => {
  const roster = synthesizeRosterFromParticipants({ ghost: { hr_device: '1' } });
  assert.equal(roster[0].id, 'ghost');
  assert.equal(roster[0].display_name, 'ghost');
});

test('synthesized roster drives correct per-participant names AND distinct HR (no "Unknown", no collapse)', () => {
  const roster = synthesizeRosterFromParticipants({
    kckern: { display_name: 'KC Kern', hr_device: '40475' },
    felix: { display_name: 'Felix', hr_device: '28812' }
  });
  const session = {
    sessionId: 'S1', startTime: 1_000_000, endTime: 1_060_000,
    timeline: {
      interval_seconds: 5,
      series: {
        'kckern:hr': JSON.stringify([[150, 12]]),
        'felix:hr': JSON.stringify([[120, 12]])
      }
    },
    snapshots: { captures: [{ index: 0, timestamp: 1_000_000, role: 'camera', filename: '0.jpg' }] },
    roster
  };
  const frames = new TimelapseFrameMapper().buildFrames(session, { speedup: 10, outputFps: 10 });
  const p = frames[0].participants;
  assert.deepEqual(p.map(x => x.displayName), ['KC Kern', 'Felix']);   // not "Unknown"
  assert.equal(p[0].hr, 150);
  assert.equal(p[1].hr, 120);                                          // distinct, not collapsed onto 150
});
