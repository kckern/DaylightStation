import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthesizeRosterFromParticipants, deriveHasVideo } from './YamlSessionDatastore.mjs';
import { TimelapseFrameMapper } from '#domains/fitness/services/TimelapseFrameMapper.mjs';

// Regression: the v2 `participants` map must synthesize roster entries that carry
// the slug as `id` and the name as `display_name`. Dropping the slug made every
// participant resolve to "Unknown" and collapsed all HR onto the first series.
test('synthesizes roster entries that carry id (slug) and display_name', () => {
  const roster = synthesizeRosterFromParticipants({
    user_1: { display_name: 'User_1', hr_device: '40475', is_primary: true },
    user_2: { display_name: 'User_2', hr_device: '90003' }
  });
  assert.deepEqual(roster.map(r => r.id), ['user_1', 'user_2']);
  assert.equal(roster[0].display_name, 'User_1');
  assert.equal(roster[0].avatarRef, 'user_1');
  assert.equal(roster[1].display_name, 'User_2');
});

test('falls back to slug when a participant has no display_name', () => {
  const roster = synthesizeRosterFromParticipants({ ghost: { hr_device: '1' } });
  assert.equal(roster[0].id, 'ghost');
  assert.equal(roster[0].display_name, 'ghost');
});

test('synthesized roster drives correct per-participant names AND distinct HR (no "Unknown", no collapse)', () => {
  const roster = synthesizeRosterFromParticipants({
    user_1: { display_name: 'User_1', hr_device: '40475' },
    user_2: { display_name: 'User_2', hr_device: '90003' }
  });
  const session = {
    sessionId: 'S1', startTime: 1_000_000, endTime: 1_060_000,
    timeline: {
      interval_seconds: 5,
      series: {
        'user_1:hr': JSON.stringify([[150, 12]]),
        'user_2:hr': JSON.stringify([[120, 12]])
      }
    },
    snapshots: { captures: [{ index: 0, timestamp: 1_000_000, role: 'camera', filename: '0.jpg' }] },
    roster
  };
  const frames = new TimelapseFrameMapper().buildFrames(session, { speedup: 10, outputFps: 10 });
  const p = frames[0].participants;
  assert.deepEqual(p.map(x => x.displayName), ['User_1', 'User_2']);   // not "Unknown"
  assert.equal(p[0].hr, 150);
  assert.equal(p[1].hr, 120);                                          // distinct, not collapsed onto 150
});

test('deriveHasVideo: true only when timelapse is ready with a videoPath', () => {
  assert.equal(
    deriveHasVideo({ timelapse: { status: 'ready', videoPath: 'media/video/fitness/x.mp4' } }),
    true
  );
});

test('deriveHasVideo: false for processing/failed/skipped or missing videoPath', () => {
  assert.equal(deriveHasVideo({ timelapse: { status: 'processing' } }), false);
  assert.equal(deriveHasVideo({ timelapse: { status: 'failed', error: 'x' } }), false);
  assert.equal(deriveHasVideo({ timelapse: { status: 'skipped', reason: 'x' } }), false);
  assert.equal(deriveHasVideo({ timelapse: { status: 'ready' } }), false); // no videoPath
});

test('deriveHasVideo: false when no timelapse block at all', () => {
  assert.equal(deriveHasVideo({}), false);
  assert.equal(deriveHasVideo(null), false);
});
