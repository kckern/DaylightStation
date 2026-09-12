import { describe, it, expect, beforeEach } from 'vitest';
import { AuthorizePlay } from './AuthorizePlay.mjs';

const T0 = Date.parse('2026-09-11T20:00:00.000Z');
const now = () => new Date(T0).toISOString();
const quiet = { info() {} };
const CONTENT = { contentId: 'retroarch:gb/test', title: 'Test Game' };

let recorded;
const intents = { record: async (i) => { recorded.push(i); return i; } };
const build = (confirm, over = {}) => new AuthorizePlay({
  authorization: { confirmIdentity: confirm },
  intents, now, logger: quiet, ...over,
});
const args = { deviceId: 'tv', surface: 'console-emulator', content: CONTENT };

beforeEach(() => { recorded = []; });

describe('AuthorizePlay — issuing', () => {
  it('issues a permission when identity is confirmed', async () => {
    const r = await build(async () => ({ confirmed: true, userId: 'test-learner' })).execute(args);
    expect(r).toMatchObject({ authorized: true, userId: 'test-learner' });
    expect(recorded).toHaveLength(1);
  });

  it('scopes the permission to this device and this title', async () => {
    await build(async () => ({ confirmed: true, userId: 'test-learner' })).execute(args);
    const intent = recorded[0];
    expect(intent.authorizes({ deviceId: 'tv', contentId: 'retroarch:gb/test' })).toBe(true);
    expect(intent.authorizes({ deviceId: 'garage-tv', contentId: 'retroarch:gb/test' })).toBe(false);
    expect(intent.authorizes({ deviceId: 'tv', contentId: 'retroarch:gb/other' })).toBe(false);
  });

  it('expires, so a trip to the reader cannot be banked', async () => {
    await build(async () => ({ confirmed: true, userId: 'test-learner' })).execute({ ...args, ttlMs: 10 * 60_000 });
    const intent = recorded[0];
    expect(intent.isExpired(new Date(T0 + 9 * 60_000).toISOString())).toBe(false);
    expect(intent.isExpired(new Date(T0 + 11 * 60_000).toISOString())).toBe(true);
  });

  it('gives enough time to walk back from another room', async () => {
    await build(async () => ({ confirmed: true, userId: 'test-learner' })).execute(args);
    const walk = 4 * 60_000;
    expect(recorded[0].isExpired(new Date(T0 + walk).toISOString())).toBe(false);
  });

  it('records the grant reference so the trail survives the separation', async () => {
    await build(async () => ({ confirmed: true, userId: 'test-learner' })).execute({ ...args, grantRef: 'grant_9' });
    expect(recorded[0].grantRef).toBe('grant_9');
  });

  it('passes enrolled credentials to the reader', async () => {
    let seen;
    await build(async ({ candidates }) => { seen = candidates; return { confirmed: true, userId: 'u' }; },
      { credentialsFor: async () => ['uuid-1'] }).execute(args);
    expect(seen).toEqual(['uuid-1']);
  });
});

describe('AuthorizePlay — refusal is not silence', () => {
  it('issues nothing when the finger is not recognised', async () => {
    const r = await build(async () => ({ confirmed: false, reason: 'not_recognised' })).execute(args);
    expect(r.authorized).toBe(false);
    expect(r.reason).toBe('not_recognised');
    expect(recorded).toEqual([]);
  });

  it('reports nobody-came distinctly from rejected', async () => {
    const r = await build(async () => ({ confirmed: false, reason: 'no_response' })).execute(args);
    expect(r.reason).toBe('no_response');
  });

  it('reports an unavailable reader without issuing anything', async () => {
    const r = await build(async () => ({ confirmed: false, reason: 'unavailable' })).execute(args);
    expect(r).toMatchObject({ authorized: false, reason: 'unavailable', intent: null });
  });

  it('refuses to authorise something unnamed', async () => {
    const uc = build(async () => ({ confirmed: true, userId: 'u' }));
    await expect(uc.execute({ deviceId: 'tv', surface: 's' })).rejects.toThrow(/contentId/);
  });
});
