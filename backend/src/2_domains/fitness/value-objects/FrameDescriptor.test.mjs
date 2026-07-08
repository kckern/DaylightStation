import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameDescriptor } from './FrameDescriptor.mjs';

test('FrameDescriptor holds frame spec and is frozen', () => {
  const fd = new FrameDescriptor({
    frameIndex: 3,
    wallClockMs: 1781312900980,
    elapsedRealMs: 30000,
    cameraTimestamp: 1781312900000,
    playerContentId: 'plex:674287',
    playerOffsetMs: 5000,
    title: 'Daytona USA 2001',
    participants: [{ id: 'user_1', displayName: 'KC', hr: 142, color: '#f00', avatarRef: null }],
    zone: 'hot',
    rpm: 86
  });
  assert.equal(fd.frameIndex, 3);
  assert.equal(fd.rpm, 86);
  assert.equal(fd.participants.length, 1);
  assert.throws(() => { fd.rpm = 0; }, TypeError); // frozen
});

test('FrameDescriptor requires a non-negative frameIndex', () => {
  assert.throws(() => new FrameDescriptor({ frameIndex: -1, wallClockMs: 1, elapsedRealMs: 0 }),
    /frameIndex/);
});

test('FrameDescriptor tolerates absent player + empty participants', () => {
  const fd = new FrameDescriptor({ frameIndex: 0, wallClockMs: 1, elapsedRealMs: 0 });
  assert.equal(fd.playerContentId, null);
  assert.deepEqual(fd.participants, []);
});
