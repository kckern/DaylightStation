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
    snapshots: { captures: [
      { index: 0, timestamp: 0, path: 'a/0.jpg', filename: '0.jpg', role: 'camera' },
      { index: 0, timestamp: 100, path: 'p/0.jpg', filename: 'p0.jpg', role: 'player' }
    ] },
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
      cleanup: async (...a) => { calls.cleaned = a; },
      moveToTrash: async (...a) => { calls.trashed = a; }
    },
    frameMapper: {
      buildFrames: (s) => (s.snapshots.captures.some(c => (c.role || 'camera') === 'camera') ? [{
        frameIndex: 0, cameraTimestamp: 0, playerTimestamp: 100, playerContentId: 'plex:1',
        title: 'X', showTitle: 'Show', participants: [{ id: 'kc', displayName: 'KC', hr: 120 }],
        elapsedRealMs: 0, wallClockMs: 0, zone: 'hot', rpm: 80, coins: 25
      }] : [])
    },
    frameRenderer: { renderFrame: async (args) => { calls.rendered.push(args); return Buffer.from([0xff, 0xd8, 1, 2, 3]); } },
    // Write a real (non-empty) file so the MP4-confirmation gate passes.
    videoEncoder: { encodeSequence: async ({ outputPath }) => { fs.writeFileSync(outputPath, Buffer.from('fake-mp4-bytes')); return { outputPath }; } },
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
  // player frame came from the stored role:player capture
  assert.ok(f.calls.rendered[0].playerBuffer);
  // raw frames MOVED TO TRASH on success (soft-delete, not hard rm)
  assert.ok(f.calls.trashed);
  assert.equal(f.calls.cleaned, undefined);
});

test('confirmed MP4 is required before frames are trashed: missing/empty output -> failed, frames KEPT', async () => {
  // Encoder "succeeds" but produces no real file (0 bytes) — we must NOT trash the frames.
  const f = fakes();
  f.videoEncoder.encodeSequence = async ({ outputPath }) => { fs.writeFileSync(outputPath, Buffer.alloc(0)); return {}; };
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'failed');
  assert.equal(f.calls.trashed, undefined);   // frames preserved for a retry
  assert.equal(f.saved.at(-1).timelapse.status, 'failed');
});

test('no MP4 file at all -> failed, frames KEPT', async () => {
  const f = fakes();
  f.videoEncoder.encodeSequence = async () => ({}); // writes nothing
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'failed');
  assert.equal(f.calls.trashed, undefined);
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

test('no player capture -> playerBuffer null, still encodes (PiP skipped)', async () => {
  const sessionData = baseSession();
  sessionData.snapshots.captures = [{ index: 0, timestamp: 0, filename: '0.jpg', role: 'camera' }];
  const f = fakes({ sessionData });
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

test('non-finalized session that ended within the merge window -> deferred, nothing rendered/cleaned/saved', async () => {
  // The session could still be resumed/merged; rendering would delete its frames.
  const sessionData = baseSession();
  sessionData.finalized = false;
  sessionData.endTime = Date.now() - 60_000; // ended a minute ago — well inside the 30-min window
  const f = fakes({ sessionData });
  let encoded = false; f.videoEncoder.encodeSequence = async () => { encoded = true; return {}; };
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'deferred');
  assert.equal(res.reason, 'within-merge-window');
  assert.equal(encoded, false);          // never encoded
  assert.equal(f.calls.cleaned, undefined); // CRITICAL: frames preserved for the eventual consolidated recap
  assert.equal(f.saved.length, 0);        // session status untouched, so a later trigger retries cleanly
});

test('already-ready session is skipped (idempotent) — no re-render that would fail on cleaned frames', async () => {
  const sessionData = baseSession();
  sessionData.finalized = true;
  sessionData.timelapse = { status: 'ready', videoPath: 'media/video/fitness/x.mp4' };
  const f = fakes({ sessionData });
  let encoded = false; f.videoEncoder.encodeSequence = async () => { encoded = true; return {}; };
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'already');
  assert.equal(res.priorStatus, 'ready');
  assert.equal(encoded, false);
  assert.equal(f.calls.cleaned, undefined);
  assert.equal(f.saved.length, 0); // status untouched
});

test('processing session is skipped unless forced', async () => {
  const sessionData = baseSession();
  sessionData.finalized = true;
  sessionData.timelapse = { status: 'processing', startedAt: 1 };
  const f = fakes({ sessionData });
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'already');
  assert.equal(res.priorStatus, 'processing');
});

test('force:true overrides the idempotency guard and re-renders', async () => {
  const sessionData = baseSession();
  sessionData.finalized = true;
  sessionData.timelapse = { status: 'ready', videoPath: 'media/video/fitness/x.mp4' };
  const f = fakes({ sessionData });
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h', force: true });
  assert.equal(res.status, 'ready');
  assert.ok(f.calls.trashed);
});

test('finalized session bypasses the merge window and renders immediately', async () => {
  const sessionData = baseSession();
  sessionData.finalized = true;
  sessionData.endTime = Date.now(); // just ended, but a clean split — never mergeable
  const f = fakes({ sessionData });
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'ready');
  assert.ok(f.calls.trashed);
});
