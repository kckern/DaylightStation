import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composePianoSpeakerPush } from './pianoSpeakerPush.mjs';

const base = { deviceId: 'yellow-room-tablet', location: 'Yellow Room', timezone: 'America/Los_Angeles' };

test('needs-help names the room, says what was tried, says what to check', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'needs-help' });
  assert.equal(p.title, "🎹 Piano speaker won't reconnect (Yellow Room)");
  assert.match(p.message, /Tried 5 fixes, including restarting the piano\./);
  assert.match(p.message, /Bluetooth dongle/);
  assert.equal(p.data.tag, 'piano-speaker-yellow-room-tablet');
  assert.equal(p.data.importance, 'high');
});

test('unpowered tells a person to turn the plug back on', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'unpowered' });
  assert.match(p.title, /Piano is unpowered \(Yellow Room\)/);
  assert.match(p.message, /could not turn it back on/);
  assert.equal(p.data.tag, 'piano-speaker-yellow-room-tablet');
});

test('back replaces the card quietly with the outage length', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'back', downMs: 25 * 60_000 });
  assert.equal(p.title, '🎹 Piano speaker is back (Yellow Room)');
  assert.equal(p.message, 'Working again after 25 min.');
  assert.equal(p.data.alert_once, true);
});

test('never puts the device id in the text', () => {
  for (const kind of ['needs-help', 'unpowered', 'back']) {
    const p = composePianoSpeakerPush({ ...base, kind, downMs: 60_000 });
    assert.doesNotMatch(`${p.title} ${p.message}`, /yellow-room-tablet/);
  }
});

test('unknown kind is null', () => {
  assert.equal(composePianoSpeakerPush({ ...base, kind: 'nope' }), null);
});
