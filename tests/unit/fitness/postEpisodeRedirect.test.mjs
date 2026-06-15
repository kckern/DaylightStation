// tests/unit/fitness/postEpisodeRedirect.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';

let resolvePostEpisodeRedirect;

beforeAll(async () => {
  const mod = await import('#frontend/modules/Fitness/player/postEpisodeRedirect.js');
  resolvePostEpisodeRedirect = mod.resolvePostEpisodeRedirect;
});

describe('resolvePostEpisodeRedirect', () => {
  it('routes to the home screen with the selected session when a sessionId is provided', () => {
    const result = resolvePostEpisodeRedirect({ hasActiveSession: true, sessionId: 'fs_123' });
    expect(result).toEqual({
      view: 'screen',
      screenId: 'home',
      sessionId: 'fs_123',
      clearActiveModule: true,
      clearActiveCollection: true,
      clearSelectedShow: true,
    });
  });

  it('returns null when no session is active', () => {
    expect(resolvePostEpisodeRedirect({ hasActiveSession: false })).toBeNull();
  });

  it('still routes to home when sessionId is missing (no highlight)', () => {
    const result = resolvePostEpisodeRedirect({ hasActiveSession: true });
    expect(result.view).toBe('screen');
    expect(result.screenId).toBe('home');
    expect(result.sessionId).toBeNull();
  });

  it('treats missing input conservatively — returns null', () => {
    expect(resolvePostEpisodeRedirect({})).toBeNull();
    expect(resolvePostEpisodeRedirect()).toBeNull();
    expect(resolvePostEpisodeRedirect(null)).toBeNull();
  });

  it('coerces truthy non-boolean hasActiveSession to "active"', () => {
    expect(resolvePostEpisodeRedirect({ hasActiveSession: 'some-session-id' })?.view).toBe('screen');
  });

  it('coerces 0/"" falsy hasActiveSession to "no session"', () => {
    expect(resolvePostEpisodeRedirect({ hasActiveSession: 0 })).toBeNull();
    expect(resolvePostEpisodeRedirect({ hasActiveSession: '' })).toBeNull();
  });

  it('flags returnToShow with a stringified showId on a short browse-out', () => {
    const result = resolvePostEpisodeRedirect({
      hasActiveSession: true,
      sessionId: 'fs_123',
      returnToShow: true,
      showId: 662027,
    });
    expect(result.returnToShow).toBe(true);
    expect(result.showId).toBe('662027');
    // Home fields remain as the fallback when no show is mounted to return to
    expect(result.view).toBe('screen');
    expect(result.screenId).toBe('home');
  });

  it('does not flag returnToShow when no showId is available', () => {
    const result = resolvePostEpisodeRedirect({
      hasActiveSession: true,
      sessionId: 'fs_123',
      returnToShow: true,
      showId: null,
    });
    expect(result.returnToShow).toBeUndefined();
    expect(result.showId).toBeUndefined();
    expect(result.view).toBe('screen');
  });

  it('does not flag returnToShow when the long-workout caller leaves it false', () => {
    const result = resolvePostEpisodeRedirect({
      hasActiveSession: true,
      sessionId: 'fs_123',
      returnToShow: false,
      showId: 662027,
    });
    expect(result.returnToShow).toBeUndefined();
    expect(result.showId).toBeUndefined();
  });
});
