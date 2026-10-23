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

test('needs-help with the plug rungs skipped says the piano was not restarted, and why', () => {
  const cases = [
    ['no-plug', /no plug is set up/],
    ['power-unknown', /power reading was unavailable/],
    ['plug-cap', /already restarted twice this hour/],
  ];
  for (const [reason, why] of cases) {
    const p = composePianoSpeakerPush({ ...base, kind: 'needs-help', reason: 'ladder-exhausted', skipped: [{ rung: 4, reason }, { rung: 5, reason }] });
    assert.match(p.message, /Tried the Bluetooth fixes; the piano was not restarted/);
    assert.match(p.message, why);
    assert.doesNotMatch(p.message, /including restarting the piano/);
  }
});

test('piano-stayed-off says the piano did not come back on', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'needs-help', reason: 'piano-stayed-off', skipped: [] });
  assert.equal(p.title, "🎹 Piano didn't come back on (Yellow Room)");
  assert.match(p.message, /Switch the piano on/);
});

test('a full ladder keeps the original copy', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'needs-help', reason: 'ladder-exhausted', skipped: [] });
  assert.match(p.message, /Tried 5 fixes, including restarting the piano\./);
});
