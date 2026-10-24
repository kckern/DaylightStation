import { describe, expect, it } from 'vitest';
import { FitnessLiveSessionAuthority } from "./FitnessLiveSessionAuthority.mjs";

describe('FitnessLiveSessionAuthority', () => {
  it('gives one eligible client the writer role and later clients the same live session as mirrors', () => {
    const authority = new FitnessLiveSessionAuthority({ now: () => 1000, createSessionId: () => 'fs_shared' });
    expect(authority.claim('home', 'firefox', { writerEligible: true }))
      .toEqual({ role: 'writer', sessionId: 'fs_shared', startTime: 1000 });
    expect(authority.claim('home', 'chrome', { writerEligible: false }))
      .toEqual({ role: 'mirror', sessionId: 'fs_shared', startTime: 1000 });
  });

  it('keeps an ineligible screen waiting until an eligible writer starts', () => {
    const authority = new FitnessLiveSessionAuthority({ createSessionId: () => 'fs_shared' });
    expect(authority.claim('home', 'chrome', { writerEligible: false }).role).toBe('waiting');
  });

  it('reports the live session read-only and forgets it once the writer goes quiet', () => {
    let now = 1000;
    const authority = new FitnessLiveSessionAuthority({ ttlMs: 100, now: () => now, createSessionId: () => 'fs_shared' });
    expect(authority.current('home')).toBeNull();
    authority.claim('home', 'firefox', { writerEligible: true });
    expect(authority.current('home')).toBe('fs_shared');
    now = 1100;
    expect(authority.current('home')).toBeNull();
    expect(authority.claim('home', 'chrome', { writerEligible: false }).role).toBe('waiting');
  });
});
