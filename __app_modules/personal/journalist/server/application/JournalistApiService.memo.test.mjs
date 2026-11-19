import test from 'node:test';
import assert from 'node:assert/strict';
import { JournalistApiService } from './JournalistApiService.mjs';

function build({ devices = { phone: ['user_1'] }, throwOnLookup = false } = {}) {
  const events = [];
  const service = new JournalistApiService({
    submitVoiceMemo: {
      execute: async (command) => ({ kind: 'accepted', memoId: command.memoId }),
      admission: (question) => ({ allowed: true, asked: question }),
    },
    memoDeviceUsers: (deviceKey) => {
      if (throwOnLookup) throw new Error('config unavailable');
      return devices[deviceKey];
    },
    resolveConversationId: (username) => {
      if (username !== 'user_1') throw new Error('Cannot resolve Telegram ID');
      return 'telegram:b1_c2';
    },
    logger: { warn: (event, data) => events.push({ event, data }) },
  });
  return { service, events };
}

test('a registered device may send memos for the users it is bound to', () => {
  const { service } = build({ devices: { phone: ['user_1', 'user_3'], 'kitchen-tablet': [] } });
  assert.equal(service.memoDeviceAllowed('fleet:phone', 'user_1'), true);
  assert.equal(service.memoDeviceAllowed('fleet:phone', 'user_3'), true);
  assert.equal(service.memoDeviceAllowed('fleet:phone', 'user_2'), false);
  assert.equal(service.memoDeviceAllowed('fleet:kitchen-tablet', 'user_1'), false);
});

test('anything that is not a registered fleet device is refused', () => {
  const { service } = build({ devices: { phone: ['user_1'], office: 'user_1', hall: null } });
  for (const deviceId of ['fleet:unknown', 'browser:phone', 'phone', '', null, 'fleet:', 'fleet:pho ne', 'fleet:office', 'fleet:hall', 'fleet:__proto__']) {
    assert.equal(service.memoDeviceAllowed(deviceId, 'user_1'), false, String(deviceId));
  }
  assert.equal(service.memoDeviceAllowed('fleet:phone', ''), false);
});

test('a binding that cannot be read refuses, and says why in the log', () => {
  const { service, events } = build({ throwOnLookup: true });
  assert.equal(service.memoDeviceAllowed('fleet:phone', 'user_1'), false);
  assert.equal(events[0].event, 'journalist.memo.deviceLookupFailed');
});

test('with no binding source configured every device is refused', () => {
  const service = new JournalistApiService({ submitVoiceMemo: {} });
  assert.equal(service.memoDeviceAllowed('fleet:phone', 'user_1'), false);
});

test('the admission question goes to the memo use case', () => {
  const { service } = build();
  assert.deepEqual(service.memoAdmission({ username: 'user_1', memoId: 'm1', bytes: 5 }), {
    allowed: true, asked: { username: 'user_1', memoId: 'm1', bytes: 5 },
  });
});

test('a user with no Journalist conversation has none, with no fallback', () => {
  const { service, events } = build();
  assert.equal(service.memoConversationFor('user_1'), 'telegram:b1_c2');
  assert.equal(service.memoConversationFor('user_2'), null);
  assert.equal(service.memoConversationFor(''), null);
  assert.equal(events[0].event, 'journalist.memo.identityResolutionFailed');
});
