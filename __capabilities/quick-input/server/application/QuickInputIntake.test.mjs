import test from 'node:test';
import assert from 'node:assert/strict';
import { QuickInputIntake } from './QuickInputIntake.mjs';
import { QuickInputLedger, ATTEMPTS_PER_INPUT } from './QuickInputLedger.mjs';
import { QuickInputEndpoint } from './QuickInputEndpoint.mjs';

const NOW = Date.UTC(2026, 10, 18, 20, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function memoryStore(files = new Map()) {
  return {
    files,
    read: (username) => (files.has(username) ? structuredClone(files.get(username)) : null),
    write: (username, data) => { files.set(username, structuredClone(data)); return true; },
  };
}

/** A bot that stores nothing the intake can look up: the ledger alone remembers. */
function build({ kind = 'photo', outcome = {}, fail = 0, replies, lookup, store = memoryStore(), limits } = {}) {
  const calls = { process: [], sent: [], notified: 0 };
  const events = [];
  let failures = fail;
  const handler = {
    process: async (input) => {
      calls.process.push(input);
      if (failures > 0) { failures -= 1; throw new Error('the bot failed'); }
      return typeof outcome === 'function' ? outcome(calls) : outcome;
    },
    ...(replies ? { replies: replies(calls) } : {}),
    ...(lookup ? { lookup } : {}),
  };
  const ledger = new QuickInputLedger({ store, clock: () => NOW, limits });
  const intake = new QuickInputIntake({
    bot: 'nutribot', kind, handler, ledger, clock: () => NOW,
    logger: { info: (event, data) => events.push({ event, data }), warn: (event, data) => events.push({ event, data }) },
  });
  return { intake, calls, events, ledger, store };
}

const input = (over = {}) => ({
  conversationId: 'telegram:b1_c2', username: 'user_1', inputId: 'i1',
  body: Buffer.from('bytes'), mimeType: 'image/jpeg', ...over,
});

test('an input is processed once and answered accepted with the bot\'s summary', async () => {
  const { intake, calls } = build({ outcome: { summary: { items: 2 } } });
  assert.deepEqual(await intake.execute(input()), { kind: 'accepted', inputId: 'i1', items: 2 });
  assert.equal(calls.process.length, 1);
  assert.equal(calls.process[0].capturedAt, null);
  assert.deepEqual(await intake.execute(input()), { kind: 'duplicate', inputId: 'i1' });
  assert.equal(calls.process.length, 1);
});

test('a finished input is a duplicate for a fresh process, and for that kind only', async () => {
  const first = build();
  await first.intake.execute(input());
  const restarted = build({ store: first.store });
  assert.deepEqual(await restarted.intake.execute(input()), { kind: 'duplicate', inputId: 'i1' });
  const otherKind = build({ store: first.store, kind: 'text' });
  assert.equal((await otherKind.intake.execute(input())).kind, 'accepted');
});

test('two uploads of one input at the same moment run once', async () => {
  const { intake, calls } = build();
  const [a, b] = await Promise.all([intake.execute(input()), intake.execute(input())]);
  assert.equal(a.kind, 'accepted');
  assert.equal(b.kind, 'accepted');
  assert.equal(calls.process.length, 1);
});

test('an input the bot failed on is processed again on the retry', async () => {
  const { intake, calls } = build({ fail: 1 });
  await assert.rejects(intake.execute(input()), /the bot failed/);
  assert.equal((await intake.execute(input())).kind, 'accepted');
  assert.equal(calls.process.length, 2);
});

test('an input with nothing usable in it is not processed twice, and the user is told once', async () => {
  for (const nothing of ['unusable_input', 'empty_transcription']) {
    const { intake, calls } = build({ outcome: (c) => ({ nothing, notify: async () => { c.notified += 1; } }) });
    assert.deepEqual(await intake.execute(input()), { kind: nothing, inputId: 'i1' });
    assert.deepEqual(await intake.execute(input()), { kind: nothing, inputId: 'i1' });
    assert.equal(calls.process.length, 1);
    assert.equal(calls.notified, 1);
  }
});

test('a bot that lacks a service it needs says so, and the input can be sent again', async () => {
  let configured = false;
  const { intake, calls } = build({ outcome: () => (configured ? {} : { unavailable: true }) });
  assert.deepEqual(await intake.execute(input()), { kind: 'unavailable', inputId: 'i1' });
  configured = true;
  assert.equal((await intake.execute(input())).kind, 'accepted');
  assert.equal(calls.process.length, 2);
});

test('telling the user that failed does not fail the input', async () => {
  const { intake, events } = build({ outcome: { nothing: 'unusable_input', notify: async () => { throw new Error('chat is down'); } } });
  assert.equal((await intake.execute(input())).kind, 'unusable_input');
  assert.deepEqual(events[0].data, { inputId: 'i1', username: 'user_1', bot: 'nutribot', kind: 'photo', error: 'chat is down' });
});

test('replies not sent by an earlier attempt are sent by the retry, and only those', async () => {
  let down = 1;
  const { intake, calls } = build({
    replies: (c) => [
      { step: 'receipt', send: async () => { c.sent.push('receipt'); } },
      { step: 'tip', send: async () => { if (down > 0) { down -= 1; throw new Error('chat is down'); } c.sent.push('tip'); } },
    ],
  });
  await assert.rejects(intake.execute(input()), /chat is down/);
  assert.deepEqual(await intake.execute(input()), { kind: 'resumed', inputId: 'i1' });
  assert.deepEqual(calls.sent, ['receipt', 'tip']);
  assert.equal(calls.process.length, 1);
  assert.deepEqual(await intake.execute(input()), { kind: 'duplicate', inputId: 'i1' });
});

test('a bot that can look the input up in its own store decides whether it was taken in', async () => {
  const taken = new Set();
  const { intake, calls } = build({
    lookup: async (i) => (taken.has(i.inputId) ? { found: true } : null),
    outcome: () => { taken.add('i1'); return {}; },
  });
  assert.equal((await intake.execute(input())).kind, 'accepted');
  // Stored by the bot, and no ledger record left: finished.
  const later = build({ lookup: async () => ({ found: true }) });
  assert.deepEqual(await later.intake.execute(input()), { kind: 'duplicate', inputId: 'i1' });
  assert.equal(later.calls.process.length, 0);
  assert.equal(calls.process.length, 1);
});

test('the time an input was captured is passed on when it can be believed, and noted when it cannot', async () => {
  const believed = build();
  await believed.intake.execute(input({ recordedAt: NOW - 2 * DAY }));
  assert.equal(believed.calls.process[0].capturedAt.getTime(), NOW - 2 * DAY);
  assert.equal(believed.events.length, 0);

  const ignored = build();
  await ignored.intake.execute(input({ recordedAt: NOW - 31 * DAY }));
  assert.equal(ignored.calls.process[0].capturedAt, null);
  assert.deepEqual(ignored.events, [{
    event: 'quick_input.recordedAtIgnored',
    data: { inputId: 'i1', username: 'user_1', bot: 'nutribot', kind: 'photo', reason: 'too_old' },
  }]);
});

test('past the daily allowance an input is refused before the bot sees it', async () => {
  const { intake, calls } = build({ limits: { inputs: 1 } });
  await intake.execute(input());
  const refused = await intake.execute(input({ inputId: 'i2' }));
  assert.equal(refused.kind, 'daily_limit');
  assert.equal(refused.limit, 'inputs');
  assert.ok(refused.retryAfterSeconds > 0);
  assert.equal(calls.process.length, 1);

  const bySize = build({ limits: { bytes: 4 } });
  assert.equal((await bySize.intake.execute(input())).limit, 'bytes');
  assert.equal(bySize.calls.process.length, 0);
});

test('an input that keeps failing stops being tried for the day', async () => {
  const { intake, calls } = build({ limits: { inputs: 1 }, fail: 100 });
  for (let attempt = 0; attempt < ATTEMPTS_PER_INPUT; attempt += 1) {
    await assert.rejects(intake.execute(input()), /the bot failed/);
  }
  assert.equal((await intake.execute(input())).kind, 'daily_limit');
  assert.equal(calls.process.length, ATTEMPTS_PER_INPUT);
});

test('the gate can ask ahead of the body whether an input would be taken', async () => {
  const { intake } = build({ limits: { inputs: 1, bytes: 100 } });
  assert.deepEqual(intake.admission({ username: 'user_1', inputId: 'i1', bytes: 50 }), { allowed: true });
  assert.equal(intake.admission({ username: 'user_1', inputId: 'i1', bytes: 101 }).limit, 'bytes');
});

test('the collaborators are required', () => {
  const all = { bot: 'nutribot', kind: 'text', handler: { process() {} }, ledger: { record() {}, admission() {} } };
  for (const name of Object.keys(all)) {
    assert.throws(() => new QuickInputIntake({ ...all, [name]: undefined }), new RegExp(name));
  }
});

// ---- the endpoint a route talks to ----

test('an endpoint answers the route from the intake and the bot\'s own notions', async () => {
  const { intake } = build();
  const warnings = [];
  const endpoint = new QuickInputEndpoint({
    intake,
    deviceUsers: (key) => ({ phone: ['user_1'] })[key],
    resolveConversationId: (username) => {
      if (username !== 'user_1') throw new Error('no such user');
      return 'telegram:b1_c2';
    },
    logger: { warn: (event, data) => warnings.push({ event, data }) },
  });
  assert.equal(endpoint.available(), true);
  assert.equal(endpoint.deviceAllowed('fleet:phone', 'user_1'), true);
  assert.equal(endpoint.deviceAllowed('fleet:phone', 'user_2'), false);
  assert.equal(endpoint.deviceAllowed('fleet:tablet', 'user_1'), false);
  assert.equal(endpoint.conversationFor('user_1'), 'telegram:b1_c2');
  assert.equal(endpoint.conversationFor('user_2'), null);
  assert.equal(endpoint.conversationFor(''), null);
  assert.equal(warnings[0].event, 'quick_input.identityResolutionFailed');
  assert.deepEqual(endpoint.admission({ username: 'user_1', inputId: 'i1', bytes: 1 }), { allowed: true });
  assert.equal((await endpoint.submit(input())).kind, 'accepted');
});

test('an endpoint with no intake, or one switched off, is unavailable; a binding that cannot be read binds nobody', () => {
  assert.equal(new QuickInputEndpoint({ intake: null }).available(), false);
  const { intake } = build();
  assert.equal(new QuickInputEndpoint({ intake, isAvailable: () => false }).available(), false);
  const warnings = [];
  const broken = new QuickInputEndpoint({
    intake, deviceUsers: () => { throw new Error('config unavailable'); },
    logger: { warn: (event) => warnings.push(event) },
  });
  assert.equal(broken.deviceAllowed('fleet:phone', 'user_1'), false);
  assert.deepEqual(warnings, ['quick_input.deviceLookupFailed']);
});

test('a durable partial capture resumes at the byte limit and costs one attempt', async () => {
  const { ledger } = build({ limits: { bytes: 5, inputs: 1 } });
  ledger.countAttempt('user_1', 'photo', 'i1', 5);
  let resumed = 0;
  const intake = new QuickInputIntake({ bot: 'nutribot', kind: 'photo', ledger, handler: {
    findCapture: async () => ({ complete: false, state: { id: 1 } }),
    finishCapture: async ({ id }) => { assert.equal(id, 1); resumed++; },
    process: async () => assert.fail('reparsed saved meal'),
  } });
  assert.equal(intake.admission(input()).allowed, true);
  assert.equal((await intake.execute(input())).kind, 'resumed');
  assert.equal((await intake.execute(input())).kind, 'duplicate');
  assert.equal(resumed, 1);
  assert.deepEqual(ledger.usage('user_1'), { inputs: 1, bytes: 5, attempts: 2 });
});
