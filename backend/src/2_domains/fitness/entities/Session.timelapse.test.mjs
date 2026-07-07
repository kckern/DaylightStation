import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from './Session.mjs';

function activeSession() {
  return new Session({ sessionId: '20260612180809', startTime: 1000 });
}

test('markTimelapseProcessing sets processing status', () => {
  const s = activeSession();
  s.markTimelapseProcessing(Date.now());
  assert.equal(s.timelapse.status, 'processing');
});

test('attachTimelapse records the ready video', () => {
  const s = activeSession();
  s.attachTimelapse({ videoPath: 'media/video/fitness/x.mp4', durationSeconds: 180, fps: 10, frameCount: 1800, now: Date.now() });
  assert.equal(s.timelapse.status, 'ready');
  assert.equal(s.timelapse.videoPath, 'media/video/fitness/x.mp4');
  assert.equal(s.timelapse.frameCount, 1800);
});

test('attachTimelapse requires videoPath', () => {
  assert.throws(() => activeSession().attachTimelapse({ durationSeconds: 1, now: Date.now() }), /videoPath/);
});

test('markTimelapseSkipped records the reason', () => {
  const s = activeSession();
  s.markTimelapseSkipped('no-captures', Date.now());
  assert.equal(s.timelapse.status, 'skipped');
  assert.equal(s.timelapse.reason, 'no-captures');
});

test('markTimelapseFailed records the error message', () => {
  const s = activeSession();
  s.markTimelapseFailed(new Error('ffmpeg blew up'), Date.now());
  assert.equal(s.timelapse.status, 'failed');
  assert.match(s.timelapse.error, /ffmpeg/);
});

test('timelapse survives toJSON/fromJSON round-trip', () => {
  const s = activeSession();
  s.attachTimelapse({ videoPath: 'p.mp4', durationSeconds: 5, fps: 10, frameCount: 50, now: Date.now() });
  const round = Session.fromJSON(s.toJSON());
  assert.equal(round.timelapse.status, 'ready');
  assert.equal(round.timelapse.videoPath, 'p.mp4');
});
