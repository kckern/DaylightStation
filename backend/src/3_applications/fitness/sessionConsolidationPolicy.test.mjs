import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecapReadiness, evaluateAbandonedSkeleton, SESSION_RESUME_MERGE_WINDOW_MS } from './sessionConsolidationPolicy.mjs';

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
