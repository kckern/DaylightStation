import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecapReadiness, evaluateAbandonedSkeleton, classifySessionMediaDir, SESSION_RESUME_MERGE_WINDOW_MS } from './sessionConsolidationPolicy.mjs';

const NOW = 1_700_000_000_000;

test('finalized session is settled immediately, regardless of how recently it ended', () => {
  const r = evaluateRecapReadiness({ finalized: true, endTime: NOW, now: NOW });
  assert.equal(r.settled, true);
  assert.equal(r.reason, 'finalized');
});

test('an active (not-yet-ended) session is never settled', () => {
  for (const endTime of [null, 0, undefined]) {
    const r = evaluateRecapReadiness({ finalized: false, endTime, now: NOW });
    assert.equal(r.settled, false);
    assert.equal(r.reason, 'not-ended');
  }
});

test('a non-finalized session within the merge window is NOT settled (would jump the gun)', () => {
  const endTime = NOW - (SESSION_RESUME_MERGE_WINDOW_MS - 1000); // ended 1s shy of the window
  const r = evaluateRecapReadiness({ finalized: false, endTime, now: NOW });
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'within-merge-window');
  assert.equal(r.msSinceEnd, SESSION_RESUME_MERGE_WINDOW_MS - 1000);
});

test('a non-finalized session past the merge window has settled (resume/merge no longer possible)', () => {
  const endTime = NOW - (SESSION_RESUME_MERGE_WINDOW_MS + 1000);
  const r = evaluateRecapReadiness({ finalized: false, endTime, now: NOW });
  assert.equal(r.settled, true);
  assert.equal(r.reason, 'merge-window-elapsed');
});

test('the boundary is inclusive: exactly at the window elapsed counts as settled', () => {
  const endTime = NOW - SESSION_RESUME_MERGE_WINDOW_MS;
  const r = evaluateRecapReadiness({ finalized: false, endTime, now: NOW });
  assert.equal(r.settled, true);
});

test('endTime accepts a date string (persisted form), not only ms epoch', () => {
  const endTime = new Date(NOW - (SESSION_RESUME_MERGE_WINDOW_MS - 1000)).toISOString();
  const r = evaluateRecapReadiness({ finalized: false, endTime, now: NOW });
  assert.equal(r.settled, false);
  assert.equal(r.reason, 'within-merge-window');
});

// ---- evaluateAbandonedSkeleton -------------------------------------------------
// A rosterless "skeleton" session is created by the always-on screenshot capture
// path even when no rider tags in. It never gets an endTime (the persistence
// roster gate blocks save_session), so the recap sweep would defer it forever and
// leak its frames. Reap it once capture has stopped past the merge window.

test('reaps a stale, never-ended, rosterless skeleton', () => {
  const r = evaluateAbandonedSkeleton({
    finalized: false, endTime: null, rosterSize: 0,
    lastCaptureMs: NOW - (SESSION_RESUME_MERGE_WINDOW_MS + 1000), now: NOW
  });
  assert.equal(r.reap, true);
  assert.equal(r.reason, 'abandoned-skeleton');
});

test('does NOT reap when any participant is on the roster', () => {
  const r = evaluateAbandonedSkeleton({
    finalized: false, endTime: null, rosterSize: 1,
    lastCaptureMs: NOW - (SESSION_RESUME_MERGE_WINDOW_MS + 1000), now: NOW
  });
  assert.equal(r.reap, false);
  assert.equal(r.reason, 'has-roster');
});

test('does NOT reap a finalized session', () => {
  const r = evaluateAbandonedSkeleton({
    finalized: true, endTime: null, rosterSize: 0,
    lastCaptureMs: NOW - (SESSION_RESUME_MERGE_WINDOW_MS + 1000), now: NOW
  });
  assert.equal(r.reap, false);
  assert.equal(r.reason, 'finalized');
});

test('does NOT reap a session that has an endTime (it ended normally)', () => {
  const r = evaluateAbandonedSkeleton({
    finalized: false, endTime: NOW - (SESSION_RESUME_MERGE_WINDOW_MS + 1000), rosterSize: 0,
    lastCaptureMs: NOW - (SESSION_RESUME_MERGE_WINDOW_MS + 1000), now: NOW
  });
  assert.equal(r.reap, false);
  assert.equal(r.reason, 'ended');
});

test('does NOT reap while capture is still recent (rider may yet tag in)', () => {
  const r = evaluateAbandonedSkeleton({
    finalized: false, endTime: null, rosterSize: 0,
    lastCaptureMs: NOW - (SESSION_RESUME_MERGE_WINDOW_MS - 1000), now: NOW
  });
  assert.equal(r.reap, false);
  assert.equal(r.reason, 'recently-active');
});

test('does NOT reap when capture activity is unknown (no timestamp to age out)', () => {
  for (const lastCaptureMs of [null, undefined, NaN]) {
    const r = evaluateAbandonedSkeleton({
      finalized: false, endTime: null, rosterSize: 0, lastCaptureMs, now: NOW
    });
    assert.equal(r.reap, false);
    assert.equal(r.reason, 'no-capture-activity');
  }
});

// ---- classifySessionMediaDir ---------------------------------------------------
// The garbage collector walks media/apps/fitness/sessions/<date>/<id> dirs and
// decides what to do with each based on disk + session facts.

const STALE = SESSION_RESUME_MERGE_WINDOW_MS + 1000;
const RECENT = SESSION_RESUME_MERGE_WINDOW_MS - 1000;

test('prunes an empty leftover dir once it has aged past the window', () => {
  const r = classifySessionMediaDir({ hasFiles: false, dirAgeMs: STALE });
  assert.equal(r.action, 'prune-empty');
});

test('keeps an empty dir that is still recent (a live session may be mid-capture)', () => {
  const r = classifySessionMediaDir({ hasFiles: false, dirAgeMs: RECENT });
  assert.equal(r.action, 'keep');
  assert.equal(r.reason, 'empty-recent');
});

test('deletes an aged orphan frame dir (frames present, no session record)', () => {
  const r = classifySessionMediaDir({ hasFiles: true, sessionExists: false, dirAgeMs: STALE });
  assert.equal(r.action, 'delete-orphan');
});

test('keeps a recent orphan (session YAML may not be written yet)', () => {
  const r = classifySessionMediaDir({ hasFiles: true, sessionExists: false, dirAgeMs: RECENT });
  assert.equal(r.action, 'keep');
  assert.equal(r.reason, 'orphan-recent');
});

test('keeps frames of a not-yet-settled session (recap may still come)', () => {
  const r = classifySessionMediaDir({
    hasFiles: true, sessionExists: true, finalized: false, endTime: NOW - RECENT,
    hasCameraFrames: true, timelapseStatus: null, dirAgeMs: RECENT, now: NOW
  });
  assert.equal(r.action, 'keep');
  assert.equal(r.reason, 'session-active');
});

test('keeps a settled session with camera frames awaiting its recap', () => {
  const r = classifySessionMediaDir({
    hasFiles: true, sessionExists: true, finalized: true, endTime: NOW,
    hasCameraFrames: true, timelapseStatus: null, dirAgeMs: STALE, now: NOW
  });
  assert.equal(r.action, 'keep');
  assert.equal(r.reason, 'recap-pending');
});

test('deletes frames of a settled, camera-less (un-recappable) session', () => {
  const r = classifySessionMediaDir({
    hasFiles: true, sessionExists: true, finalized: true, endTime: NOW,
    hasCameraFrames: false, timelapseStatus: null, dirAgeMs: STALE, now: NOW
  });
  assert.equal(r.action, 'delete-frames');
  assert.equal(r.reason, 'no-camera-unrecappable');
});

test('deletes leftover frames after a recap already succeeded (ready)', () => {
  const r = classifySessionMediaDir({
    hasFiles: true, sessionExists: true, finalized: true, endTime: NOW,
    hasCameraFrames: true, timelapseStatus: 'ready', dirAgeMs: STALE, now: NOW
  });
  assert.equal(r.action, 'delete-frames');
  assert.equal(r.reason, 'post-recap-leftover');
});

test('deletes frames of a terminally skipped session', () => {
  const r = classifySessionMediaDir({
    hasFiles: true, sessionExists: true, finalized: true, endTime: NOW,
    hasCameraFrames: false, timelapseStatus: 'skipped', dirAgeMs: STALE, now: NOW
  });
  assert.equal(r.action, 'delete-frames');
});

test('keeps frames of a settled FAILED recap with camera (sweep will retry)', () => {
  const r = classifySessionMediaDir({
    hasFiles: true, sessionExists: true, finalized: true, endTime: NOW,
    hasCameraFrames: true, timelapseStatus: 'failed', dirAgeMs: STALE, now: NOW
  });
  assert.equal(r.action, 'keep');
  assert.equal(r.reason, 'recap-pending');
});
