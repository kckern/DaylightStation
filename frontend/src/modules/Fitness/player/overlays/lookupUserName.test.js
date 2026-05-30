import { describe, it, expect } from 'vitest';
import { lookupUserName } from './lookupUserName.js';

const users = [
  { id: 'user_3', name: 'User_3' },
  { id: 'kckern', name: 'Kevin' },
  { id: 'user_4', name: 'User_4' },
];

describe('lookupUserName', () => {
  it('resolves a user slug to the configured given name', () => {
    expect(lookupUserName(users, 'user_3')).toBe('User_3');
    expect(lookupUserName(users, 'kckern')).toBe('Kevin');
  });

  it('matches case-insensitively', () => {
    expect(lookupUserName(users, 'USER_3')).toBe('User_3');
  });

  it('falls back to the raw userId when no user matches', () => {
    expect(lookupUserName(users, 'guest1')).toBe('guest1');
  });

  it('falls back to the raw userId when the list is missing or empty', () => {
    expect(lookupUserName(null, 'user_3')).toBe('user_3');
    expect(lookupUserName([], 'user_3')).toBe('user_3');
    expect(lookupUserName(undefined, 'user_3')).toBe('user_3');
  });

  it('falls back to the raw userId when the matched user has no name', () => {
    expect(lookupUserName([{ id: 'user_3' }], 'user_3')).toBe('user_3');
  });
});
