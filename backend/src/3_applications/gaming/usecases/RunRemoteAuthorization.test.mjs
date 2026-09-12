import { describe, it, expect, beforeEach } from 'vitest';
import { RunRemoteAuthorization } from './RunRemoteAuthorization.mjs';

const quiet = { warn() {} };
let calls;
const presence = {
  raise: async (prompt) => { calls.push(['raise', prompt]); return { ok: true }; },
  release: async () => { calls.push(['release']); },
};
const args = { deviceId: 'tv', surface: 'console-emulator', content: { contentId: 'g:1', title: 'Test Game' } };
const build = (authorize, p = presence) => new RunRemoteAuthorization({
  presence: p, authorizePlay: { execute: authorize }, logger: quiet,
});

beforeEach(() => { calls = []; });

describe('RunRemoteAuthorization', () => {
  it('wakes the room, asks, then puts the room back', async () => {
    const r = await build(async () => ({ authorized: true, userId: 'child' })).execute(args);
    expect(r.authorized).toBe(true);
    expect(calls.map((c) => c[0])).toEqual(['raise', 'release']);
  });

  it('tells the person what they are authorising', async () => {
    await build(async () => ({ authorized: true, userId: 'c' })).execute(args);
    expect(calls[0][1]).toContain('Test Game');
  });

  it('puts the room back even when nobody comes', async () => {
    await build(async () => ({ authorized: false, reason: 'no_response' })).execute(args);
    expect(calls).toContainEqual(['release']);
  });

  it('puts the room back even when the scan throws', async () => {
    const r = await build(async () => { throw new Error('reader exploded'); }).execute(args);
    expect(r.reason).toBe('unavailable');
    expect(calls).toContainEqual(['release']);
  });

  it('still asks when the room could not be woken — that is not a refusal', async () => {
    // The child has declined nothing; blaming them for our infrastructure would
    // be both wrong and confusing.
    const cold = { raise: async () => ({ ok: false, error: 'screen offline' }), release: async () => { calls.push(['release']); } };
    const r = await build(async () => ({ authorized: true, userId: 'child' }), cold).execute(args);
    expect(r.authorized).toBe(true);
  });

  it('works with no room to wake at all', async () => {
    const r = await build(async () => ({ authorized: true, userId: 'child' }), null).execute(args);
    expect(r.authorized).toBe(true);
  });

  it('a failing release never changes the answer', async () => {
    const flaky = { raise: async () => ({ ok: true }), release: async () => { throw new Error('stuck'); } };
    const r = await build(async () => ({ authorized: true, userId: 'child' }), flaky).execute(args);
    expect(r.authorized).toBe(true);
  });
});
