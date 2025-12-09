import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePause, PAUSE_REASON } from './pauseArbiter.js';

test('governance precedence over other pauses', () => {
  const result = resolvePause({
    governance: { blocked: true },
    resilience: { stalled: true },
    user: { paused: true }
  });
  assert.equal(result.paused, true);
  assert.equal(result.reason, PAUSE_REASON.GOVERNANCE);
});

test('resilience precedence over user pause', () => {
  const result = resolvePause({
    governance: { blocked: false },
    resilience: { stalled: true },
    user: { paused: true }
  });
  assert.equal(result.paused, true);
  assert.equal(result.reason, PAUSE_REASON.BUFFERING);
});

test('user pause when no governance or resilience pause', () => {
  const result = resolvePause({
    governance: { blocked: false },
    resilience: { stalled: false },
    user: { paused: true }
  });
  assert.equal(result.paused, true);
  assert.equal(result.reason, PAUSE_REASON.USER);
});

test('playing when no pauses active', () => {
  const result = resolvePause();
  assert.equal(result.paused, false);
  assert.equal(result.reason, PAUSE_REASON.PLAYING);
});
