import { describe, expect, it, vi } from 'vitest';
import { WithingsOAuth } from '#adapters/harvester/fitness/WithingsOAuth.mjs';

const make = (post) => new WithingsOAuth({ httpClient: { post }, clientId: 'cid', clientSecret: 'sec', now: () => new Date('2026-10-20T19:00:00Z') });

describe('WithingsOAuth', () => {
  it('requires httpClient and client credentials', () => {
    expect(() => new WithingsOAuth({ httpClient: { post: vi.fn() }, clientId: 'cid' })).toThrow(TypeError);
  });
  it('builds the authorize URL', () => {
    const url = new URL(make(vi.fn()).authorizeUrl({ redirectUri: 'https://example.test/cb', state: 's1' }));
    expect(url.origin + url.pathname).toBe('https://account.withings.com/oauth2_user/authorize2');
    expect(Object.fromEntries(url.searchParams)).toEqual({ response_type: 'code', client_id: 'cid', scope: 'user.metrics', redirect_uri: 'https://example.test/cb', state: 's1' });
  });
  it('exchanges a code for the saved token shape', async () => {
    const post = vi.fn().mockResolvedValue({ data: { status: 0, body: { userid: 42, access_token: 'a', refresh_token: 'r', scope: 'user.metrics', token_type: 'Bearer', expires_in: 10800 } } });
    const tokens = await make(post).exchangeCode({ code: 'c', redirectUri: 'https://example.test/cb' });
    expect(post).toHaveBeenCalledWith('https://wbsapi.withings.net/v2/oauth2', expect.objectContaining({ action: 'requesttoken', grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://example.test/cb' }));
    expect(tokens).toEqual({ userid: '42', access_token: 'a', refresh_token: 'r', scope: 'user.metrics', token_type: 'Bearer', expires_at: '2026-10-20T22:00:00.000Z' });
  });
  it('throws the Withings error for a rejected code', async () => {
    const post = vi.fn().mockResolvedValue({ data: { status: 503, body: {}, error: 'Invalid Params: invalid code' } });
    await expect(make(post).exchangeCode({ code: 'old', redirectUri: 'x' })).rejects.toThrow('Invalid Params: invalid code');
  });
  it('wraps transport errors without leaking the client secret', async () => {
    const post = vi.fn().mockRejectedValue(new Error('socket hang up; body client_secret=sec'));
    const err = await make(post).exchangeCode({ code: 'c', redirectUri: 'x' }).catch((e) => e);
    expect(err.message).toMatch(/^Withings token request failed/);
    expect(err.message).not.toMatch(/=sec\b/);
  });
});
