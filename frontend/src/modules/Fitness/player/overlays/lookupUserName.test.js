import { describe, it, expect } from 'vitest';
import { lookupUserName } from './lookupUserName.js';

const users = [
  { id: 'user_3', name: 'User_3 Kern', groupLabel: 'User_3' },
  { id: 'kckern', name: 'User_1', groupLabel: 'Dad' },
  { id: 'user_4', name: 'User_4 Kern' }, // no nickname
];

describe('lookupUserName', () => {
  it('prefers the household nickname (groupLabel) when set', () => {
    expect(lookupUserName(users, 'kckern')).toBe('Dad');
    expect(lookupUserName(users, 'user_3')).toBe('User_3');
  });

  it('falls back to the given name when there is no nickname', () => {
    expect(lookupUserName(users, 'user_4')).toBe('User_4 Kern');
  });

  it('matches case-insensitively', () => {
    expect(lookupUserName(users, 'KCKERN')).toBe('Dad');
  });

  it('falls back to the raw userId when no user matches', () => {
    expect(lookupUserName(users, 'guest1')).toBe('guest1');
  });

  it('falls back to the raw userId when the list is missing or empty', () => {
    expect(lookupUserName(null, 'user_3')).toBe('user_3');
    expect(lookupUserName([], 'user_3')).toBe('user_3');
    expect(lookupUserName(undefined, 'user_3')).toBe('user_3');
  });

  it('falls back to the raw userId when the matched user has no name or nickname', () => {
    expect(lookupUserName([{ id: 'user_3' }], 'user_3')).toBe('user_3');
  });
});
