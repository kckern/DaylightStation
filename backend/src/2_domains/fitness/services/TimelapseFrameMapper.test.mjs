import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimelapseFrameMapper } from './TimelapseFrameMapper.mjs';

function fakeSession() {
  // 60s session, interval 5s -> 12 ticks
  return {
    sessionId: 'S1',
    startTime: 1000_000,            // ms
    endTime: 1000_000 + 60_000,
    treasureBox: { totalCoins: 120 },
    timeline: {
      interval_seconds: 5,
      tick_count: 12,
      series: {
        // RLE-encoded JSON strings (as persisted)
        'bike:7138:rpm': JSON.stringify([[80, 6], [90, 6]]), // 80 for ticks 0-5, 90 for 6-11
        'kckern:hr': JSON.stringify([[140, 12]]),
        'kckern:zone': JSON.stringify([['active', 12]])
      },
      events: [
        { timestamp: 1000_000, type: 'media', data: { contentId: 'plex:674287', title: 'Daytona USA', grandparentTitle: 'Game Cycling' } }
      ]
    },
    snapshots: { captures: [
      { index: 0, timestamp: 1000_000, path: 'a/0.jpg', filename: '0.jpg', role: 'camera' },
      { index: 1, timestamp: 1000_000 + 40_000, path: 'a/1.jpg', filename: '1.jpg', role: 'camera' },
      { index: 0, timestamp: 1000_000 + 48_000, path: 'p/0.jpg', filename: 'p0.jpg', role: 'player' }
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
  // nearest camera capture to 1,050,000 is index 1 (at +40s) vs index 0 (at 0s)
  assert.equal(f.cameraTimestamp, 1000_000 + 40_000);
  // nearest player capture (role:player at +48s) is chosen for the PiP frame
  assert.equal(f.playerTimestamp, 1000_000 + 48_000);
  // contentId still carried (used for the show poster), title from the media event
  assert.equal(f.playerContentId, 'plex:674287');
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

test('carries show title (grandparentTitle) and animates coins up to the total', () => {
  const mapper = new TimelapseFrameMapper();
  const frames = mapper.buildFrames(fakeSession(), { speedup: 10, outputFps: 10 });
  assert.equal(frames[0].showTitle, 'Game Cycling');
  assert.equal(frames[50].title, 'Daytona USA');
  // coins are non-decreasing and reach the total by the final frame
  assert.ok(frames[10].coins <= frames[50].coins);
  assert.equal(frames.at(-1).coins, 120);
});

test('honors a provided resolveName for participant display names', () => {
  const mapper = new TimelapseFrameMapper();
  const s = fakeSession();
  s.roster = [{ id: 'kckern' }]; // no display_name -> falls back to resolver
  const frames = mapper.buildFrames(s, { speedup: 10, outputFps: 10, resolveName: (slug) => slug === 'kckern' ? 'KC' : slug });
  assert.equal(frames[0].participants[0].displayName, 'KC');
});

test('builds per-bike cadence (equipment + assigned colour); excludes idle bikes', () => {
  const s = fakeSession();
  s.timeline.series['bike:7138:rpm'] = JSON.stringify([[66, 12]]);
  s.timeline.series['bike:49904:rpm'] = JSON.stringify([[0, 12]]);   // idle -> excluded
  const frames = new TimelapseFrameMapper().buildFrames(s, {
    speedup: 10, outputFps: 10,
    cadenceDevices: { 7138: 'niceday', 49904: 'cycle_ace' },
    cadenceColors: { 7138: 'orange', 49904: 'yellow' }
  });
  const cad = frames[50].cadence;
  assert.equal(cad.length, 1);
  assert.equal(cad[0].equipment, 'niceday');
  assert.equal(cad[0].rpm, 66);
  assert.equal(cad[0].color, '#ff922b');   // orange via strapColors SSOT
});

test('prefers group labels when 2+ riders are present (KC -> Dad)', () => {
  const s = fakeSession();
  s.roster = [{ id: 'kckern' }, { id: 'felix' }];
  s.timeline.series['felix:hr'] = JSON.stringify([[120, 12]]);
  const frames = new TimelapseFrameMapper().buildFrames(s, {
    speedup: 10, outputFps: 10,
    resolveName: (id) => (id === 'kckern' ? 'KC Kern' : id),
    resolveGroupLabel: (id) => (id === 'kckern' ? 'Dad' : id)   // felix has no label -> returns id
  });
  assert.deepEqual(frames[0].participants.map(p => p.displayName), ['Dad', 'felix']);
});

test('keeps the full name for a solo rider (no group)', () => {
  const s = fakeSession();
  s.roster = [{ id: 'kckern' }];
  const frames = new TimelapseFrameMapper().buildFrames(s, {
    speedup: 10, outputFps: 10,
    resolveName: () => 'KC Kern', resolveGroupLabel: () => 'Dad'
  });
  assert.equal(frames[0].participants[0].displayName, 'KC Kern');
});

test('carries the session timezone onto each frame', () => {
  const s = fakeSession(); s.timezone = 'America/Los_Angeles';
  const frames = new TimelapseFrameMapper().buildFrames(s, { speedup: 10, outputFps: 10 });
  assert.equal(frames[0].timezone, 'America/Los_Angeles');
});

test('no cadence config -> descriptor.cadence is null', () => {
  const frames = new TimelapseFrameMapper().buildFrames(fakeSession(), { speedup: 10, outputFps: 10 });
  assert.equal(frames[50].cadence, null);
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
