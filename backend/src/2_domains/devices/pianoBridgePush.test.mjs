import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composePianoBridgePush } from './pianoBridgePush.mjs';
import { findPushTextDefects } from '../notification/push/pushText.mjs';

const base = { deviceId: 'yellow-room-tablet', location: 'Yellow Room', timezone: 'America/Los_Angeles' };

for (const kind of ['down', 'one-way', 'recovered']) {
  for (const extra of [{ since: '2026-09-28T00:09:28Z', downMs: 7_500_000 }, {}]) {
    test(`${kind} ${extra.since ? 'with' : 'without'} times has no push-text defects`, () => {
      const push = composePianoBridgePush({ kind, ...base, ...extra });
      assert.deepEqual(findPushTextDefects(push.title), []);
      assert.deepEqual(findPushTextDefects(push.message), []);
      assert.equal(push.data.tag, 'piano-bridge-yellow-room-tablet');
      assert.ok(!push.title.includes('yellow-room-tablet'));
    });
  }
}

test('down reads the local clock time, not UTC', () => {
  const push = composePianoBridgePush({ kind: 'down', ...base, since: '2026-09-28T00:09:28Z' });
  assert.match(push.message, /5:09\sPM/);
});

test('recovered says how long, and does not ring again', () => {
  const push = composePianoBridgePush({ kind: 'recovered', ...base, downMs: 7_500_000 });
  assert.match(push.message, /2 hr 5 min/);
  assert.equal(push.data.alert_once, true);
});

test('unknown kind composes nothing', () => {
  assert.equal(composePianoBridgePush({ kind: 'nope', ...base }), null);
});
