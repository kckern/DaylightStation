import { describe, it, expect } from 'vitest';
import { NutribotDirectInput } from './NutribotDirectInput.mjs';
import { QuickInputLedger } from '../../../../../../__capabilities/quick-input/server/public.mjs';

const NOW = Date.UTC(2026, 10, 18, 20, 0, 0);

function memoryStore() {
  const files = new Map();
  return {
    read: (username) => (files.has(username) ? structuredClone(files.get(username)) : null),
    write: (username, data) => { files.set(username, structuredClone(data)); return true; },
  };
}

function build({ unbound = {}, limits, ledger, fail = 0,
  devices = { 'kitchen-tablet': { quick_input: { nutribot: ['user_1', 'user_2'] } }, 'hall-tv': { quick_input: { journalist: ['user_1'] } } } } = {}) {
  const calls = { upc: [], image: [], text: [] };
  let failures = fail;
  const op = (name) => async (command) => {
    calls[name].push(command);
    if (failures > 0) { failures -= 1; throw new Error('lookup failed'); }
    return { success: true, name };
  };
  const direct = new NutribotDirectInput({
    ledger: ledger === undefined ? new QuickInputLedger({ store: memoryStore(), clock: () => NOW, limits }) : ledger,
    deviceConfig: (key) => devices[key],
    unboundUsers: (route) => unbound[route],
    resolveIdentity: (username) => {
      if (!['user_1', 'user_2'].includes(username)) throw new Error('no such user');
      return { username, conversationIdString: `telegram:b9_c${username.at(-1)}` };
    },
    operations: { upc: op('upc'), image: op('image'), text: op('text') },
    clock: () => NOW,
    logger: {},
  });
  return { direct, calls };
}

const ask = (direct, over = {}) => direct.authorize({
  route: 'upc', deviceId: null, hasAppHeader: false, sessionUser: null, requestedUser: null, ...over,
});

describe('who may use a Nutribot direct-input route', () => {
  it('a device bound for Nutribot, for a user it lists, who must be named', () => {
    const { direct } = build();
    expect(ask(direct, { deviceId: 'fleet:kitchen-tablet', requestedUser: 'user_2' }))
      .toEqual({ allowed: true, username: 'user_2', via: 'device' });
    expect(ask(direct, { deviceId: 'fleet:kitchen-tablet' }))
      .toEqual({ allowed: false, status: 400, reason: 'user_required' });
    expect(ask(direct, { deviceId: 'fleet:kitchen-tablet', requestedUser: 'user_3' }))
      .toEqual({ allowed: false, status: 403, reason: 'device_not_allowed' });
  });

  it('not a device bound for another bot, an unknown one, a browser id or nothing at all', () => {
    const { direct } = build();
    for (const deviceId of ['fleet:hall-tv', 'fleet:unknown', 'browser:abc123', 'kitchen-tablet', null]) {
      expect(ask(direct, { deviceId, requestedUser: 'user_1' }))
        .toEqual({ allowed: false, status: 403, reason: 'device_not_allowed' });
    }
  });

  it('a signed-in user of the app, for themselves only, when the request carries the app\'s header', () => {
    const { direct } = build();
    const session = { sessionUser: 'user_1', hasAppHeader: true, deviceId: 'browser:abc123' };
    expect(ask(direct, session)).toEqual({ allowed: true, username: 'user_1', via: 'session' });
    expect(ask(direct, { ...session, requestedUser: 'user_1' })).toMatchObject({ allowed: true, username: 'user_1' });
    expect(ask(direct, { ...session, requestedUser: 'user_2' }))
      .toEqual({ allowed: false, status: 403, reason: 'device_not_allowed' });
    // A session cookie alone rides along on a cross-site navigation; the header does not.
    expect(ask(direct, { sessionUser: 'user_1', hasAppHeader: false }))
      .toEqual({ allowed: false, status: 403, reason: 'device_not_allowed' });
  });

  it('anyone, on a route the household has opened to callers that cannot name a device, for the users listed there', () => {
    const { direct } = build({ unbound: { upc: ['user_2', 'user_1'] } });
    // No user named: the first listed. There is no fallback to the head of household.
    expect(ask(direct)).toEqual({ allowed: true, username: 'user_2', via: 'unbound' });
    expect(ask(direct, { requestedUser: 'user_1' })).toEqual({ allowed: true, username: 'user_1', via: 'unbound' });
    expect(ask(direct, { requestedUser: 'user_3' })).toEqual({ allowed: false, status: 403, reason: 'device_not_allowed' });
    // Opened for /upc only.
    expect(ask(direct, { route: 'text' })).toEqual({ allowed: false, status: 403, reason: 'device_not_allowed' });
  });

  it('a malformed open-route setting opens nothing', () => {
    for (const setting of ['user_1', true, [], [1, null], { user: 'user_1' }]) {
      const { direct } = build({ unbound: { upc: setting } });
      expect(ask(direct).allowed).toBe(false);
    }
  });

  it('a bound device is still held to its own list on an open route', () => {
    const { direct } = build({ unbound: { upc: ['user_1'] } });
    expect(ask(direct, { deviceId: 'fleet:kitchen-tablet', requestedUser: 'user_2' })).toMatchObject({ allowed: true, via: 'device' });
    expect(ask(direct, { deviceId: 'fleet:hall-tv' })).toEqual({ allowed: true, username: 'user_1', via: 'unbound' });
  });

  it('knows the user\'s Nutribot conversation, or that there is none', () => {
    const { direct } = build();
    expect(direct.context('user_1')).toEqual({ userId: 'user_1', conversationId: 'telegram:b9_c1' });
    expect(direct.context('user_9')).toBeNull();
  });
});

describe('running a direct input', () => {
  const run = (direct, over = {}) => direct.run({
    route: 'upc', username: 'user_1', inputId: null, command: { upc: '016000275287' }, ...over,
  });

  it('runs the route\'s operation and hands back its result', async () => {
    const { direct, calls } = build();
    expect(await run(direct)).toEqual({ kind: 'accepted', result: { success: true, name: 'upc' } });
    expect(calls.upc).toEqual([{ upc: '016000275287' }]);
    expect((await run(direct, { route: 'image', command: {} })).result.name).toBe('image');
    expect((await run(direct, { route: 'text', command: { text: 'an apple' } })).result.name).toBe('text');
  });

  it('with no id from the caller, the same request twice is two inputs', async () => {
    const { direct, calls } = build();
    await run(direct);
    await run(direct);
    expect(calls.upc).toHaveLength(2);
  });

  it('with an id from the caller, the same request twice runs once', async () => {
    const { direct, calls } = build();
    expect((await run(direct, { inputId: 'scan-1' })).kind).toBe('accepted');
    expect(await run(direct, { inputId: 'scan-1' })).toEqual({ kind: 'duplicate' });
    expect(calls.upc).toHaveLength(1);
    // The same id on another route is another input.
    expect((await run(direct, { route: 'text', inputId: 'scan-1', command: { text: 'x' } })).kind).toBe('accepted');
  });

  it('counts against the user\'s Nutribot day, the same day the quick inputs use', async () => {
    const ledger = new QuickInputLedger({ store: memoryStore(), clock: () => NOW, limits: { inputs: 2 } });
    const { direct, calls } = build({ ledger });
    ledger.countAttempt('user_1', 'photo', 'from-the-phone', 1);
    expect((await run(direct)).kind).toBe('accepted');
    const refused = await run(direct);
    expect(refused).toMatchObject({ kind: 'daily_limit', limit: 'inputs' });
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(calls.upc).toHaveLength(1);
    expect(direct.admission({ route: 'text', username: 'user_1', inputId: null, bytes: 0 }).allowed).toBe(false);
    expect(direct.admission({ route: 'text', username: 'user_2', inputId: null, bytes: 0 }).allowed).toBe(true);
  });

  it('lets a failure through, and counts the attempt', async () => {
    const ledger = new QuickInputLedger({ store: memoryStore(), clock: () => NOW });
    const { direct } = build({ ledger, fail: 1 });
    await expect(run(direct)).rejects.toThrow('lookup failed');
    expect(ledger.usage('user_1')).toMatchObject({ inputs: 1, attempts: 1 });
  });

  it('is unavailable with no ledger to count in', async () => {
    const { direct } = build({ ledger: null });
    expect(direct.available()).toBe(false);
  });
});
