// tests/unit/fitness/postEpisodeRedirect.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';

let resolvePostEpisodeRedirect;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/postEpisodeRedirect.js');
  resolvePostEpisodeRedirect = mod.resolvePostEpisodeRedirect;
});

describe('resolvePostEpisodeRedirect', () => {
  it('routes to the chart (users view) when a session is active', () => {
    const result = resolvePostEpisodeRedirect({ hasActiveSession: true });
    expect(result).toEqual({
      view: 'users',
      clearActiveModule: true,
      clearActiveCollection: true,
      clearSelectedShow: true,
    });
  });

  it('returns null when no session is active', () => {
    expect(resolvePostEpisodeRedirect({ hasActiveSession: false })).toBeNull();
  });

  it('treats missing input conservatively — returns null', () => {
    expect(resolvePostEpisodeRedirect({})).toBeNull();
    expect(resolvePostEpisodeRedirect()).toBeNull();
    expect(resolvePostEpisodeRedirect(null)).toBeNull();
  });

  it('coerces truthy non-boolean hasActiveSession to "active"', () => {
    expect(resolvePostEpisodeRedirect({ hasActiveSession: 'some-session-id' })?.view).toBe('users');
  });

  it('coerces 0/"" falsy hasActiveSession to "no session"', () => {
    expect(resolvePostEpisodeRedirect({ hasActiveSession: 0 })).toBeNull();
    expect(resolvePostEpisodeRedirect({ hasActiveSession: '' })).toBeNull();
  });
});
