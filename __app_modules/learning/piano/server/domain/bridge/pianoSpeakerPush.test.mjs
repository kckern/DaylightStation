import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composePianoSpeakerPush } from './pianoSpeakerPush.mjs';

const base = { deviceId: 'yellow-room-tablet', location: 'Yellow Room', timezone: 'America/Los_Angeles' };

test('needs-help names the room, says what was tried, says what to check', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'needs-help' });
  assert.equal(p.title, "🎹 Piano speaker won't reconnect (Yellow Room)");
  assert.match(p.message, /Tried 5 fixes, including restarting the piano\./);
  // The speaker is built into the piano — there is no dongle to check.
  assert.doesNotMatch(p.message, /dongle/i);
  assert.match(p.message, /Switch the piano off and on/);
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

test('no copy ever mentions a dongle — the speaker is built into the piano', () => {
  const kinds = [
    { kind: 'needs-help', reason: 'ladder-exhausted', skipped: [] },
    { kind: 'needs-help', reason: 'ladder-exhausted', skipped: [{ rung: 4, reason: 'no-plug' }] },
    { kind: 'needs-help', reason: 'piano-stayed-off', skipped: [] },
    { kind: 'unpowered' },
  ];
  for (const k of kinds) assert.doesNotMatch(composePianoSpeakerPush({ ...base, ...k }).message, /dongle/i);
});

test('not-ready names each broken link in plain words, on its own tag', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'not-ready', problems: ['plug-unavailable', 'bridge-endpoints-missing'] });
  assert.equal(p.title, 'Piano speaker self-repair is broken (Yellow Room)');
  assert.match(p.message, /piano's smart plug is not answering/);
  assert.match(p.message, /tablet app is missing its repair commands/);
  assert.equal(p.data.tag, 'piano-speaker-health-yellow-room-tablet');
});

test('ready-again quietly replaces the not-ready card', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'ready-again' });
  assert.match(p.title, /self-repair is working again/);
  assert.equal(p.data.tag, 'piano-speaker-health-yellow-room-tablet');
  assert.equal(p.data.alert_once, true);
});

test('weekly summary says how often it dropped and what fixed it', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'weekly', drops: 4, byRung: { 4: 3, 2: 1 }, gaveUp: 0 });
  assert.equal(p.title, '🎹 Piano speaker this week (Yellow Room)');
  assert.equal(p.message, 'Dropped 4 times and fixed itself every time: 3 by restarting the piano, 1 by a Bluetooth reset.');
  assert.equal(p.data.tag, 'piano-speaker-weekly-yellow-room-tablet');
  assert.equal(p.data.alert_once, true);
});

test('weekly summary owns up to give-ups', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'weekly', drops: 2, byRung: { 1: 1 }, gaveUp: 1 });
  assert.equal(p.message, 'Dropped 2 times: 1 by reconnecting, and 1 needed a person.');
});

test('weekly with one drop is singular', () => {
  const p = composePianoSpeakerPush({ ...base, kind: 'weekly', drops: 1, byRung: { 5: 1 }, gaveUp: 0 });
  assert.equal(p.message, 'Dropped once and fixed itself: 1 by restarting the piano.');
});
