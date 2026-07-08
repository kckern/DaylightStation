import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { GenerateSessionTimelapse, buildSlug, participantSlug, durationMinutes } from './GenerateSessionTimelapse.mjs';

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
      cleanup: async (...a) => { calls.cleaned = a; }
    },
    frameMapper: {
      buildFrames: (s) => (s.snapshots.captures.some(c => (c.role || 'camera') === 'camera') ? [{
        frameIndex: 0, cameraTimestamp: 0, playerTimestamp: 100, playerContentId: 'plex:1',
        title: 'X', showTitle: 'Show', participants: [{ id: 'kc', displayName: 'KC', hr: 120 }],
        elapsedRealMs: 0, wallClockMs: 0, zone: 'hot', rpm: 80, coins: 25
      }] : [])
    },
    frameRenderer: { renderFrame: async (args) => { calls.rendered.push(args); return Buffer.from([0xff, 0xd8, 1, 2, 3]); } },
    videoEncoder: { encodeSequence: async ({ outputPath }) => { fs.writeFileSync(outputPath, Buffer.from([0, 1, 2, 3])); return { outputPath }; } },
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

test('mp4 not written (0 bytes) -> failed, frames NOT cleaned (kept for retry)', async () => {
  const f = fakes();
  f.videoEncoder.encodeSequence = async () => ({});   // returns but writes no file
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'failed');
  assert.equal(f.calls.cleaned, undefined);            // source captures preserved
});

test('archives frames by default when archive_frames is unset', async () => {
  const f = fakes(); delete f.config.archive_frames;
  const uc = new GenerateSessionTimelapse(f);
  await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.deepEqual(f.calls.cleaned[2], { archive: true });
});

test('hard-deletes frames only when archive_frames is explicitly false', async () => {
  const f = fakes(); f.config.archive_frames = false;
  const uc = new GenerateSessionTimelapse(f);
  await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.deepEqual(f.calls.cleaned[2], { archive: false });
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
  assert.ok(f.calls.cleaned);
});

test('finalized session bypasses the merge window and renders immediately', async () => {
  const sessionData = baseSession();
  sessionData.finalized = true;
  sessionData.endTime = Date.now(); // just ended, but a clean split — never mergeable
  const f = fakes({ sessionData });
  const uc = new GenerateSessionTimelapse(f);
  const res = await uc.execute({ sessionId: '20260612180809', householdId: 'h' });
  assert.equal(res.status, 'ready');
  assert.ok(f.calls.cleaned);
});

// --- filename slug ---

test('buildSlug prefers the primary media item over earlier background audio (ESPN bug)', () => {
  const data = {
    sessionId: '20260625170246',
    session: { duration_seconds: 1825 },
    participants: { 'device:10266': {}, user_1: {}, user_3: {}, user_2: {} },
    summary: {
      media: [
        { showTitle: 'ESPN', mediaType: 'video', primary: null },          // started first, NOT primary
        { showTitle: 'Game Cycling', mediaType: 'video', primary: true }   // the real workout
      ]
    }
  };
  assert.equal(buildSlug(data), '20260625170246_30m_kckern-user_3-felix_game-cycling');
});

test('buildSlug drops the redundant date prefix (sessionId already carries the date)', () => {
  const data = {
    sessionId: '20260626151907',
    session: { duration_seconds: 2010 },
    participants: { user_1: {}, user_2: {} },
    summary: { media: [{ showTitle: 'Insanity Max:30', primary: true }] }
  };
  const slug = buildSlug(data);
  assert.equal(slug, '20260626151907_34m_kckern-felix_insanity-max-30');
  assert.equal(slug.startsWith('20260626151907_'), true);
  assert.equal(slug.includes('20260626_'), false); // no double-date
});

test('buildSlug falls back to media[0] then strava.name then "workout"', () => {
  assert.match(buildSlug({ sessionId: 's', summary: { media: [{ title: 'Only One' }] } }), /_only-one$/);
  assert.match(buildSlug({ sessionId: 's', strava: { name: 'Lunch Ride' } }), /_lunch-ride$/);
  assert.equal(buildSlug({ sessionId: 's' }), 's_workout');
});

test('buildSlug omits users/duration segments when unavailable', () => {
  const data = { sessionId: '20260101120000', summary: { media: [{ showTitle: 'Yoga', primary: true }] } };
  assert.equal(buildSlug(data), '20260101120000_yoga');
});

test('participantSlug excludes device:* pseudo-ids and preserves order', () => {
  assert.equal(participantSlug({ participants: { 'device:1': {}, user_1: {}, 'user_10': {}, user_5: {} } }),
    'kckern-user_10-user_5');
  assert.equal(participantSlug({ summary: { participants: { user_3: {} } } }), 'user_3');
  assert.equal(participantSlug({}), '');
});

test('durationMinutes rounds to nearest minute, falls back to start/end, else null', () => {
  assert.equal(durationMinutes({ session: { duration_seconds: 1825 } }), 30); // 30.4 -> 30
  assert.equal(durationMinutes({ session: { duration_seconds: 1830 } }), 31); // 30.5 -> 31
  assert.equal(durationMinutes({ startTime: 0, endTime: 90_000 }), 2);        // 1.5min -> 2
  assert.equal(durationMinutes({ session: { duration_seconds: 10 } }), 1);    // min 1
  assert.equal(durationMinutes({}), null);
});
