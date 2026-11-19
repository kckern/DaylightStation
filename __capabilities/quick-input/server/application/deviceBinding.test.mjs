import test from 'node:test';
import assert from 'node:assert/strict';
import { boundUsers, isBoundDevice } from './deviceBinding.mjs';
import { recordedTime, localDayParts } from './recordedTime.mjs';

test('a device is bound per bot', () => {
  const device = { quick_input: { journalist: ['user_1'], nutribot: ['user_1', 'user_2'] } };
  assert.deepEqual(boundUsers(device, 'journalist', 'text'), ['user_1']);
  assert.deepEqual(boundUsers(device, 'nutribot', 'photo'), ['user_1', 'user_2']);
  assert.deepEqual(boundUsers(device, 'homebot', 'text'), []);
});

test('the earlier voice memo binding still counts for Journalist voice, and only there', () => {
  const device = { voice_memo: { users: ['user_1'] }, quick_input: { journalist: ['user_3'] } };
  assert.deepEqual(boundUsers(device, 'journalist', 'voice'), ['user_3', 'user_1']);
  assert.deepEqual(boundUsers(device, 'journalist', 'text'), ['user_3']);
  assert.deepEqual(boundUsers(device, 'nutribot', 'voice'), []);
});

test('a missing or malformed binding binds nobody', () => {
  for (const device of [null, undefined, {}, { quick_input: null }, { quick_input: 'user_1' },
    { quick_input: { journalist: 'user_1' } }, { quick_input: { journalist: [1, null] } }, { voice_memo: { users: 'user_1' } }]) {
    assert.deepEqual(boundUsers(device, 'journalist', 'voice'), []);
  }
  assert.deepEqual(boundUsers({ quick_input: {} }, 'constructor', 'voice'), []);
});

test('only a registered fleet device that lists the user is bound', () => {
  const users = (key) => ({ phone: ['user_1'], hall: null, office: 'user_1' })[key];
  assert.equal(isBoundDevice('fleet:phone', 'user_1', users), true);
  for (const deviceId of ['fleet:unknown', 'browser:phone', 'phone', '', null, 'fleet:', 'fleet:pho ne', 'fleet:hall', 'fleet:office', 'fleet:__proto__']) {
    assert.equal(isBoundDevice(deviceId, 'user_1', users), false, String(deviceId));
  }
  assert.equal(isBoundDevice('fleet:phone', 'user_2', users), false);
  assert.equal(isBoundDevice('fleet:phone', '', users), false);
  assert.equal(isBoundDevice('fleet:phone', 'user_1', null), false);
});

test('a recorded time is believed within five minutes ahead and thirty days back', () => {
  const now = Date.UTC(2026, 10, 18, 20, 0, 0);
  const minute = 60 * 1000, day = 24 * 60 * minute;
  assert.equal(recordedTime(now - 2 * day, now).at.getTime(), now - 2 * day);
  assert.equal(recordedTime(now + 4 * minute, now).at.getTime(), now + 4 * minute);
  assert.deepEqual(recordedTime(null, now), { at: null, ignored: null });
  assert.deepEqual(recordedTime(now + 6 * minute, now), { at: null, ignored: 'in_the_future' });
  assert.deepEqual(recordedTime(now - 31 * day, now), { at: null, ignored: 'too_old' });
  for (const bad of [Number.NaN, 'yesterday', -5, 0]) {
    assert.deepEqual(recordedTime(bad, now), { at: null, ignored: 'not_a_time' });
  }
});

test('a moment is read off the calendar and clock of the zone it is given', () => {
  const moment = Date.UTC(2026, 10, 18, 20, 30, 0);
  assert.deepEqual(localDayParts(moment, 'America/Los_Angeles'), { date: '2026-11-18', hour: 12, secondsToMidnight: 11.5 * 3600 });
  assert.deepEqual(localDayParts(moment, 'Asia/Tokyo'), { date: '2026-11-19', hour: 5, secondsToMidnight: 18.5 * 3600 });
});
