import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimelapseFrameMapper } from './TimelapseFrameMapper.mjs';

function fakeSession() {
  // 60s session, interval 5s -> 12 ticks
  return {
    sessionId: 'S1',
    startTime: 1000_000,            // ms
    endTime: 1000_000 + 60_000,
    timeline: {
      interval_seconds: 5,
      tick_count: 12,
      series: {
        // RLE-encoded JSON strings (as persisted)
        'bike:7138:rpm': JSON.stringify([[80, 6], [90, 6]]), // 80 for ticks 0-5, 90 for 6-11
        'kckern:hr': JSON.stringify([[140, 12]])
      },
      events: [
        { timestamp: 1000_000, type: 'media', data: { contentId: 'plex:674287', title: 'Daytona USA' } }
      ]
    },
    snapshots: { captures: [
      { index: 0, timestamp: 1000_000, path: 'a/0.jpg', filename: '0.jpg' },
      { index: 1, timestamp: 1000_000 + 40_000, path: 'a/1.jpg', filename: '1.jpg' }
    ] },
    roster: [{ id: 'kckern', displayName: 'KC', color: '#f00' }]
  };
}

test('builds frameCount = ceil(outputDuration * fps) for a 10x/10fps spec', () => {
  const mapper = new TimelapseFrameMapper();
  // 60s / 10 = 6s output; * 10fps = 60 frames
  const frames = mapper.buildFrames(fakeSession(), { speedup: 10, outputFps: 10 });
  assert.equal(frames.length, 60);
  assert.equal(frames[0].frameIndex, 0);
});

test('maps elapsed real time, nearest camera capture, and media offset', () => {
  const mapper = new TimelapseFrameMapper();
  const frames = mapper.buildFrames(fakeSession(), { speedup: 10, outputFps: 10 });
  // frame 50 -> elapsedReal = (50/10)*10 = 50s -> wallClock = start+50s
  const f = frames[50];
  assert.equal(f.elapsedRealMs, 50_000);
  assert.equal(f.wallClockMs, 1000_000 + 50_000);
  // nearest capture to 1,050,000 is capture index 1 (at +40s) vs index 0 (at 0s)
  assert.equal(f.cameraTimestamp, 1000_000 + 40_000);
  // media started at session start -> offset = 50s
  assert.equal(f.playerContentId, 'plex:674287');
  assert.equal(f.playerOffsetMs, 50_000);
  assert.equal(f.title, 'Daytona USA');
});

test('reads RLE stats at the right tick', () => {
  const mapper = new TimelapseFrameMapper();
  const frames = mapper.buildFrames(fakeSession(), { speedup: 10, outputFps: 10 });
  // frame 50 -> 50s -> tick floor(50/5)=10 -> rpm 90, hr 140
  assert.equal(frames[50].rpm, 90);
  assert.equal(frames[50].participants[0].hr, 140);
  // frame 10 -> 10s -> tick 2 -> rpm 80
  assert.equal(frames[10].rpm, 80);
});

test('no captures -> empty frame list', () => {
  const mapper = new TimelapseFrameMapper();
  const s = fakeSession(); s.snapshots.captures = [];
  assert.deepEqual(mapper.buildFrames(s, { speedup: 10, outputFps: 10 }), []);
});

test('unresolved media -> playerContentId null but frames still built', () => {
  const mapper = new TimelapseFrameMapper();
  const s = fakeSession(); s.timeline.events = [];
  const frames = mapper.buildFrames(s, { speedup: 10, outputFps: 10 });
  assert.equal(frames[5].playerContentId, null);
  assert.equal(frames.length, 60);
});
