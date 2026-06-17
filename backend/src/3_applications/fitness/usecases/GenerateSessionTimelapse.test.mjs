import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { GenerateSessionTimelapse } from './GenerateSessionTimelapse.mjs';

function baseSession() {
  return {
    sessionId: '20260612180809', startTime: 0, endTime: 60_000,
    timeline: {
      interval_seconds: 5, tick_count: 12, series: {},
      events: [{ timestamp: 0, type: 'media', data: { contentId: 'plex:1', title: 'X', grandparentTitle: 'Show' } }]
    },
    snapshots: { captures: [{ index: 0, timestamp: 0, path: 'a/0.jpg', filename: '0.jpg' }] },
    roster: [{ id: 'kc', display_name: 'KC' }],
    treasureBox: { totalCoins: 50 }
  };
}

function fakes(overrides = {}) {
  const sessionData = overrides.sessionData || baseSession();
  const saved = [];
  const calls = { posters: [], avatars: 0, rendered: [] };
  const f = {
    saved, calls, sessionData,
    sessionDatastore: {
      findById: async () => sessionData,
      save: async (s) => saved.push(typeof s.toJSON === 'function' ? s.toJSON() : s)
    },
    snapshotStore: {
      listCaptures: async () => sessionData.snapshots.captures.map(c => ({ ...c, absolutePath: '/abs/' + c.filename })),
      readCapture: async () => Buffer.from([0xff, 0xd8]),
      cleanup: async (...a) => { calls.cleaned = a; }
    },
    frameMapper: {
      buildFrames: (s) => (s.snapshots.captures.length ? [{
        frameIndex: 0, cameraTimestamp: 0, playerContentId: 'plex:1', playerOffsetMs: 0,
        title: 'X', showTitle: 'Show', participants: [{ id: 'kc', displayName: 'KC', hr: 120 }],
        elapsedRealMs: 0, wallClockMs: 0, zone: 'hot', rpm: 80, coins: 25
      }] : [])
    },
    frameExtractor: { extractFrame: async () => Buffer.from([0xff, 0xd8]) },
    frameRenderer: { renderFrame: async (args) => { calls.rendered.push(args); return Buffer.from([0xff, 0xd8, 1, 2, 3]); } },
    videoEncoder: { encodeSequence: async ({ outputPath }) => ({ outputPath }) },
    contentSourceResolver: async () => '/media/plex/x.mp4',
    posterProvider: async (contentId) => { calls.posters.push(contentId); return Buffer.from([0xff, 0xd8, 9]); },
    avatarProvider: async () => { calls.avatars++; return { kc: Buffer.from([0xff, 0xd8, 7]) }; },
    resolveName: (slug) => slug.toUpperCase(),
    mediaDir: fs.mkdtempSync(path.join(os.tmpdir(), 'media-')),
    config: { enabled: true, speedup: 10, output_fps: 10, crf: 20, resolution: [1280, 720], archive_frames: false },
    fileIO: fs,
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  };
  return { ...f, ...overrides };
}

test('happy path: processing -> render with poster+avatars -> encode -> ready -> cleanup', async () => {
  const f = fakes();
  const uc = new GenerateSessionTimelapse(f);
  const result = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(result.status, 'ready');
  assert.equal(f.saved[0].timelapse.status, 'processing');
  assert.equal(f.saved.at(-1).timelapse.status, 'ready');
  // providers were used and buffers handed to the renderer
  assert.ok(f.calls.posters.length >= 1);
  assert.equal(f.calls.avatars, 1);
  assert.ok(f.calls.rendered[0].posterBuffer);
  assert.ok(f.calls.rendered[0].avatarBuffers.kc);
  // raw frames cleaned up on success
  assert.ok(f.calls.cleaned);
});

test('no captures -> skipped, no encode', async () => {
  const sessionData = baseSession(); sessionData.snapshots.captures = [];
  const f = fakes({ sessionData });
  let encoded = false; f.videoEncoder.encodeSequence = async () => { encoded = true; return {}; };
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'skipped');
  assert.equal(encoded, false);
});

test('player resolve failure still encodes (PiP skipped)', async () => {
  const f = fakes(); f.contentSourceResolver = async () => null;
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'ready');
  assert.equal(f.calls.rendered[0].playerBuffer, null);
});

test('encoder failure -> failed status, no cleanup', async () => {
  const f = fakes(); f.videoEncoder.encodeSequence = async () => { throw new Error('boom'); };
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'failed');
  assert.equal(f.calls.cleaned, undefined);
  assert.equal(f.saved.at(-1).timelapse.status, 'failed');
});

test('disabled config -> no work', async () => {
  const f = fakes(); f.config.enabled = false;
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'disabled');
});
