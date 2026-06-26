import { describe, it, expect } from 'vitest';
import { GUEST_PROFILE, resolveProfile } from './pianoUser.js';

describe('resolveProfile', () => {
  const users = [{ id: 'kc', name: 'KC' }, { id: 'user_3', name: 'User_3' }];
  it('returns the roster match for a known user', () => {
    expect(resolveProfile(users, 'user_3')).toEqual({ id: 'user_3', name: 'User_3' });
  });
  it('returns the synthetic Guest profile for "guest" (never from the roster)', () => {
    expect(resolveProfile(users, 'guest')).toEqual(GUEST_PROFILE);
    expect(users.some((u) => u.id === 'guest')).toBe(false);
  });
  it('returns null when the id is unknown / unset', () => {
    expect(resolveProfile(users, 'nobody')).toBeNull();
    expect(resolveProfile(users, null)).toBeNull();
  });
});
